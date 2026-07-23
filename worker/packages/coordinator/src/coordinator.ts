import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  CancellationSignal,
  ProcessingPipeline,
  ProcessorResolver,
  StepFailure,
} from '@workerv2/processing';
import type { RunId, Timestamp, VersionSet } from '@workerv2/control-plane';
import type { CompiledManifest } from '@workerv2/manifest';
import { toPipeline } from '@workerv2/manifest';
import type { ExecutionGraph } from './graph.js';
import { buildExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { initialExecutionState } from './execution-state.js';
import type { ReadyQueue, SchedulingOptions } from './scheduler.js';
import { computeReadyQueue, dueTimeouts } from './scheduler.js';
import type { StepId } from '@workerv2/processing';
import type { CoordinatorContext, CoordinatorStep, DispatchResult } from './transitions.js';
import {
  dispatchNode,
  reportFailure,
  reportSuccess,
  requestCancellation,
  startRun,
  tick,
} from './transitions.js';
import type { ExecutionProgress } from './progress.js';
import { progressOf } from './progress.js';
import type { JournalEntry } from './journal.js';
import { resumeFromJournal } from './resume.js';
import { validateExecutionState } from './validate.js';
import { validateProcessors } from './context.js';
import type { ReplayMode, ReplayPlan } from './replay.js';
import { describeReplay, seedReplay } from './replay.js';
import { CoordinatorError } from './errors.js';

/**
 * The COORDINATOR — the public façade over the deterministic execution core. It BINDS a run's
 * immutable execution graph (from a validated pipeline / bridged manifest) and its frozen
 * version set (INV-11) once, then exposes pure, stateless transition + query methods over an
 * `ExecutionState`. It holds NO mutable state itself, so identical inputs always yield identical
 * outputs, and any infrastructure adapter (single-process, distributed, queue-backed) can drive
 * it through this same stable API without the coordinator changing.
 *
 * It DECIDES and RECORDS; it never executes: no processor is run, nothing is rendered, no PDF
 * or image is produced, no storage/queue/network is touched, and no timer is armed (time is
 * injected into every command).
 */
export interface Coordinator {
  readonly graph: ExecutionGraph;
  readonly versions: VersionSet;

  /** The seed execution state for a run — every node pending, run pending. */
  initialize(runId: RunId): ExecutionState;

  /** Start a pending run: mark it running and arm dependency-free nodes. */
  start(state: ExecutionState, ctx: CoordinatorContext): Result<CoordinatorStep, CoordinatorError>;

  /** The deterministic ready queue at an instant (scheduling decision surface). */
  readyQueue(state: ExecutionState, now: Timestamp): ReadyQueue;

  /** Running nodes whose injected timeout deadline has elapsed. */
  dueTimeouts(state: ExecutionState, now: Timestamp): readonly StepId[];

  /** Dispatch a ready node, returning the resolved `ProcessingContext` for an engine. */
  dispatch(
    state: ExecutionState,
    nodeId: string,
    ctx: CoordinatorContext,
    cancellation?: CancellationSignal,
  ): Result<DispatchResult, CoordinatorError>;

  /** Report a node attempt that succeeded, recording its produced outputs. */
  reportSuccess(
    state: ExecutionState,
    nodeId: string,
    outputs: Readonly<Record<string, StorageKey>>,
    ctx: CoordinatorContext,
  ): Result<CoordinatorStep, CoordinatorError>;

  /** Report a node attempt that failed, applying the retry orchestrator. */
  reportFailure(
    state: ExecutionState,
    nodeId: string,
    failure: StepFailure,
    ctx: CoordinatorContext,
  ): Result<CoordinatorStep, CoordinatorError>;

  /** Advance injected time: convert elapsed timeout budgets into failures. */
  tick(state: ExecutionState, ctx: CoordinatorContext): Result<CoordinatorStep, CoordinatorError>;

  /** Request cancellation of the whole run (cancel drain across the graph). */
  requestCancellation(
    state: ExecutionState,
    ctx: CoordinatorContext,
    reason?: string,
  ): Result<CoordinatorStep, CoordinatorError>;

  /** The progress projection of a state. */
  progress(state: ExecutionState): ExecutionProgress;

  /** Validate that a state is consistent with the bound graph (the untrusted-state gate). */
  validate(state: ExecutionState): Result<void, CoordinatorError>;

  /** Verify every node's processor resolves — accepts processor interfaces WITHOUT executing them. */
  validateProcessors(resolver: ProcessorResolver): Result<void, CoordinatorError>;

  /** Rebuild an interrupted run's state from its persisted journal (Resume). */
  resume(runId: RunId, journal: readonly JournalEntry[]): Result<ExecutionState, CoordinatorError>;

  /** The declarative meaning of a replay mode (Retry/Replay/Rebuild/Regenerate). */
  planReplay(mode: ReplayMode): ReplayPlan;

  /** Seed a new run's initial state for a replay mode from a prior run's state. */
  seedReplay(
    priorState: ExecutionState,
    newRunId: RunId,
    mode: ReplayMode,
  ): Result<ExecutionState, CoordinatorError>;
}

export interface CoordinatorOptions {
  /** Purely-declarative concurrency advice for the ready queue (default unbounded). */
  readonly maxInFlight?: number;
}

export interface CoordinatorSetup {
  readonly pipeline: ProcessingPipeline;
  readonly versions: VersionSet;
  readonly options?: CoordinatorOptions;
}

/** Build a coordinator bound to a validated pipeline + frozen version set. */
export function createCoordinator(setup: CoordinatorSetup): Coordinator {
  const graph = buildExecutionGraph(setup.pipeline);
  const versions = setup.versions;
  const scheduling: SchedulingOptions =
    setup.options?.maxInFlight === undefined ? {} : { maxInFlight: setup.options.maxInFlight };

  const coordinator: Coordinator = {
    graph,
    versions,
    initialize: (runId) => initialExecutionState(graph, runId),
    start: (state, ctx) => startRun(graph, state, ctx),
    readyQueue: (state, now) => computeReadyQueue(graph, state, now, scheduling),
    dueTimeouts: (state, now) => dueTimeouts(graph, state, now),
    dispatch: (state, nodeId, ctx, cancellation) =>
      dispatchNode(graph, versions, state, nodeId, ctx, cancellation),
    reportSuccess: (state, nodeId, outputs, ctx) =>
      reportSuccess(graph, state, nodeId, outputs, ctx),
    reportFailure: (state, nodeId, failure, ctx) =>
      reportFailure(graph, state, nodeId, failure, ctx),
    tick: (state, ctx) => tick(graph, state, ctx),
    requestCancellation: (state, ctx, reason) => requestCancellation(graph, state, ctx, reason),
    progress: (state) => progressOf(state),
    validate: (state) => validateExecutionState(graph, state),
    validateProcessors: (resolver) => validateProcessors(graph, resolver),
    resume: (runId, journal) => resumeFromJournal(graph, runId, journal),
    planReplay: (mode) => describeReplay(mode),
    seedReplay: (priorState, newRunId, mode) => seedReplay(graph, priorState, newRunId, mode),
  };
  return Object.freeze(coordinator);
}

/**
 * Build a coordinator directly from a compiled Manifest — the coordinator's stated purpose is
 * to consume a Manifest. The manifest bridges LOSSLESSLY into a validated `ProcessingPipeline`
 * (`toPipeline`, ADR-0010), which the coordinator then schedules. Keeps orchestration entirely
 * separate from the manifest's declarative model.
 */
export function coordinatorFromManifest(
  compiled: CompiledManifest,
  versions: VersionSet,
  options?: CoordinatorOptions,
): Result<Coordinator, CoordinatorError> {
  const pipeline = toPipeline(compiled);
  if (!pipeline.ok) {
    return err(
      new CoordinatorError(
        `Manifest could not be bridged to a pipeline: ${pipeline.error.message}`,
      ),
    );
  }
  return ok(
    createCoordinator({
      pipeline: pipeline.value,
      versions,
      ...(options === undefined ? {} : { options }),
    }),
  );
}
