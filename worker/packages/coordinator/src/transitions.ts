import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  CancellationSignal,
  ProcessingContext,
  StepFailure,
  StepId,
} from '@workerv2/processing';
import { planFailureAction, stepFailure, validateProcessorOutputs } from '@workerv2/processing';
import type { RunId, Timestamp, VersionSet } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import type { JournalEntry, JournalEntrySpec } from './journal.js';
import { applyJournalEntry } from './journal.js';
import type { ExecutionEvent } from './events.js';
import { toExecutionEvents } from './events.js';
import { CoordinatorError } from './errors.js';
import { addMillis, isDue } from './time.js';
import { buildProcessingContext } from './context.js';
import { dependenciesSatisfied, dueTimeouts } from './scheduler.js';

/**
 * The TRANSITION CORE — the deterministic reducer that turns a coordinator COMMAND into a set
 * of journal entries, folds them into the next `ExecutionState`, and derives the published
 * events. Every command is pure: (graph, versions, state, injected time, input) → next step.
 * Nothing here executes a processor, renders, or performs I/O — the coordinator DECIDES and
 * RECORDS; an engine acts.
 */

/** The injected, time-bearing context every mutating command carries (time is never ambient). */
export interface CoordinatorContext {
  readonly at: Timestamp;
}

/** The result of a command: the next state, the entries it appended, and the events to publish. */
export interface CoordinatorStep {
  readonly state: ExecutionState;
  readonly entries: readonly JournalEntry[];
  readonly events: readonly ExecutionEvent[];
}

/** A dispatch additionally yields the resolved `ProcessingContext` an engine hands the processor. */
export interface DispatchResult extends CoordinatorStep {
  readonly context: ProcessingContext;
}

/** Assign sequence numbers to entry specs and fold them into the state (the single write path). */
function emit(
  graph: ExecutionGraph,
  state: ExecutionState,
  specs: readonly JournalEntrySpec[],
): Result<{ state: ExecutionState; entries: JournalEntry[] }, CoordinatorError> {
  let current = state;
  const entries: JournalEntry[] = [];
  for (const spec of specs) {
    const entry: JournalEntry = { ...spec, seq: current.seq };
    const next = applyJournalEntry(graph, current, entry);
    if (!next.ok) return next;
    current = next.value;
    entries.push(entry);
  }
  return ok({ state: current, entries });
}

function step(
  runId: RunId,
  result: { state: ExecutionState; entries: JournalEntry[] },
): CoordinatorStep {
  return {
    state: result.state,
    entries: result.entries,
    events: toExecutionEvents(runId, result.entries),
  };
}

function reject(
  message: string,
  context?: Record<string, string>,
): Result<never, CoordinatorError> {
  return err(new CoordinatorError(message, context === undefined ? {} : { context }));
}

/**
 * RECONCILE — the follow-up entries implied by the current state: arm newly-runnable nodes,
 * drain remaining work when the run is stopping, and finalize the run once quiescent. Pure;
 * computed on the post-primary state and folded after it.
 */
function reconcile(
  graph: ExecutionGraph,
  state: ExecutionState,
  at: Timestamp,
): JournalEntrySpec[] {
  if (state.status !== 'running' && state.status !== 'pending') return [];
  const specs: JournalEntrySpec[] = [];
  const running = graph.order.filter((id) => state.nodes[id]?.state === 'running');

  if (state.stopping === undefined) {
    if (state.status !== 'running') return [];
    for (const id of graph.order) {
      const node = state.nodes[id];
      if (node?.state === 'pending' && dependenciesSatisfied(graph, state, id)) {
        specs.push({ at, kind: 'node.armed', node: id, from: 'pending', to: 'ready' });
      }
    }
    const allSucceeded = graph.order.every((id) => state.nodes[id]?.state === 'succeeded');
    if (allSucceeded) {
      specs.push({ at, kind: 'run.succeeded', from: 'running', to: 'succeeded' });
    }
    return specs;
  }

  // Draining: skip (fail) or cancel (cancel) every node that has not started.
  for (const id of graph.order) {
    const node = state.nodes[id];
    if (node?.state !== 'pending' && node?.state !== 'ready') continue;
    if (state.stopping === 'fail') {
      specs.push({ at, kind: 'node.skipped', node: id, from: node.state, to: 'skipped' });
    } else {
      specs.push({ at, kind: 'node.cancelled', node: id, from: node.state, to: 'cancelled' });
    }
  }
  if (running.length === 0) {
    specs.push(
      state.stopping === 'fail'
        ? { at, kind: 'run.failed', from: state.status, to: 'failed' }
        : { at, kind: 'run.cancelled', from: state.status, to: 'cancelled' },
    );
  }
  return specs;
}

/** Emit the primary entries, then repeatedly fold reconcile follow-ups until stable. */
function commit(
  graph: ExecutionGraph,
  state: ExecutionState,
  primary: readonly JournalEntrySpec[],
  at: Timestamp,
): Result<{ state: ExecutionState; entries: JournalEntry[] }, CoordinatorError> {
  const first = emit(graph, state, primary);
  if (!first.ok) return first;
  const follow = emit(graph, first.value.state, reconcile(graph, first.value.state, at));
  if (!follow.ok) return follow;
  return ok({
    state: follow.value.state,
    entries: [...first.value.entries, ...follow.value.entries],
  });
}

/** Start a pending run: transition it to `running` and arm every dependency-free node. */
export function startRun(
  graph: ExecutionGraph,
  state: ExecutionState,
  ctx: CoordinatorContext,
): Result<CoordinatorStep, CoordinatorError> {
  if (state.status !== 'pending') {
    return reject(`Cannot start a run in state "${state.status}"`, { status: state.status });
  }
  const result = commit(
    graph,
    state,
    [{ at: ctx.at, kind: 'run.started', from: 'pending', to: 'running' }],
    ctx.at,
  );
  if (!result.ok) return result;
  return ok(step(state.runId, result.value));
}

/**
 * Dispatch a ready node: mark it `running` for a new attempt and return the resolved
 * `ProcessingContext` an engine hands its processor. The coordinator resolves inputs and
 * records the attempt; it never calls the processor.
 */
export function dispatchNode(
  graph: ExecutionGraph,
  versions: VersionSet,
  state: ExecutionState,
  nodeId: string,
  ctx: CoordinatorContext,
  cancellation?: CancellationSignal,
): Result<DispatchResult, CoordinatorError> {
  if (state.status !== 'running') {
    return reject(`Cannot dispatch while run is "${state.status}"`, { status: state.status });
  }
  if (state.stopping !== undefined) {
    return reject(`Cannot dispatch while run is draining (${state.stopping})`);
  }
  const node = state.nodes[nodeId];
  if (node === undefined) return reject(`Unknown node "${nodeId}"`, { node: nodeId });
  if (node.state !== 'ready') {
    return reject(`Node "${nodeId}" is not ready (state "${node.state}")`, { node: nodeId });
  }
  if (node.readyAt !== undefined && !isDue(node.readyAt, ctx.at)) {
    return reject(`Node "${nodeId}" is not yet dispatchable (backoff until ${node.readyAt})`, {
      node: nodeId,
    });
  }

  const attempt = node.attempts + 1;
  const context = buildProcessingContext(
    graph,
    state,
    versions,
    state.runId,
    nodeId,
    attempt,
    ctx.at,
    cancellation,
  );
  if (!context.ok) return context;

  const result = commit(
    graph,
    state,
    [{ at: ctx.at, kind: 'node.dispatched', node: node.id, from: 'ready', to: 'running', attempt }],
    ctx.at,
  );
  if (!result.ok) return result;
  return ok({ ...step(state.runId, result.value), context: context.value });
}

/** Report a node attempt that succeeded, recording its produced outputs. */
export function reportSuccess(
  graph: ExecutionGraph,
  state: ExecutionState,
  nodeId: string,
  outputs: Readonly<Record<string, StorageKey>>,
  ctx: CoordinatorContext,
): Result<CoordinatorStep, CoordinatorError> {
  const node = state.nodes[nodeId];
  if (node === undefined) return reject(`Unknown node "${nodeId}"`, { node: nodeId });
  if (node.state !== 'running') {
    return reject(`Node "${nodeId}" is not running (state "${node.state}")`, { node: nodeId });
  }
  const step_ = graph.nodes[nodeId];
  if (step_ === undefined) return reject(`Unknown node "${nodeId}"`, { node: nodeId });
  const conforms = validateProcessorOutputs(step_.outputs, outputs);
  if (!conforms.ok) {
    return err(
      new CoordinatorError(`Node "${nodeId}" outputs are invalid: ${conforms.error.message}`, {
        context: { node: nodeId },
      }),
    );
  }

  const result = commit(
    graph,
    state,
    [
      {
        at: ctx.at,
        kind: 'node.succeeded',
        node: node.id,
        from: 'running',
        to: 'succeeded',
        detail: { outputs: { ...outputs } },
      },
    ],
    ctx.at,
  );
  if (!result.ok) return result;
  return ok(step(state.runId, result.value));
}

/** Report a node attempt that failed, applying the RETRY ORCHESTRATOR to the declarative policy. */
export function reportFailure(
  graph: ExecutionGraph,
  state: ExecutionState,
  nodeId: string,
  failure: StepFailure,
  ctx: CoordinatorContext,
): Result<CoordinatorStep, CoordinatorError> {
  const node = state.nodes[nodeId];
  if (node === undefined) return reject(`Unknown node "${nodeId}"`, { node: nodeId });
  if (node.state !== 'running') {
    return reject(`Node "${nodeId}" is not running (state "${node.state}")`, { node: nodeId });
  }
  const specs = failureSpecs(graph, state, node.id, failure, node.attempt, ctx.at);
  const result = commit(graph, state, specs, ctx.at);
  if (!result.ok) return result;
  return ok(step(state.runId, result.value));
}

/**
 * The RETRY ORCHESTRATOR entries for a failed attempt. Reuses the processing framework's shared
 * `planFailureAction` so retry semantics can never drift from the pipeline model. A retry is a
 * `node.retry-scheduled` entry whose backoff is a FUTURE `readyAt` (no timer); a terminal
 * failure begins draining the run (`run.stopping`); a cancellation begins a cancel drain.
 */
function failureSpecs(
  graph: ExecutionGraph,
  state: ExecutionState,
  nodeId: StepId,
  failure: StepFailure,
  attempt: number,
  at: Timestamp,
): JournalEntrySpec[] {
  const step_ = graph.nodes[nodeId];
  const detail = { failureKind: failure.kind, failureMessage: failure.message };

  if (failure.kind === 'cancelled') {
    const specs: JournalEntrySpec[] = [];
    if (state.stopping === undefined) {
      specs.push({ at, kind: 'cancellation.requested', detail: { reason: failure.message } });
    }
    specs.push({
      at,
      kind: 'node.cancelled',
      node: nodeId,
      from: 'running',
      to: 'cancelled',
      detail,
    });
    return specs;
  }

  // While draining, a failed node is terminal — retrying against a dying run is pointless.
  const plan =
    step_ === undefined || state.stopping !== undefined
      ? ({ action: 'fail' } as const)
      : planFailureAction(failure, attempt, step_.retry, step_.failure);

  if (plan.action === 'retry') {
    return [
      {
        at,
        kind: 'node.retry-scheduled',
        node: nodeId,
        from: 'running',
        to: 'ready',
        attempt: plan.nextAttempt,
        detail: { ...detail, readyAt: addMillis(at, plan.delayMs) },
      },
    ];
  }
  const specs: JournalEntrySpec[] = [
    { at, kind: 'node.failed', node: nodeId, from: 'running', to: 'failed', detail },
  ];
  if (state.stopping === undefined)
    specs.unshift({ at, kind: 'run.stopping', detail: { reason: 'fail' } });
  return specs;
}

/** Request cancellation of the whole run — propagate a cancel drain across the node graph. */
export function requestCancellation(
  graph: ExecutionGraph,
  state: ExecutionState,
  ctx: CoordinatorContext,
  reason = 'cancellation requested',
): Result<CoordinatorStep, CoordinatorError> {
  if (state.status !== 'running' && state.status !== 'pending') {
    return reject(`Cannot cancel a run in state "${state.status}"`, { status: state.status });
  }
  if (state.stopping !== undefined) {
    // Already draining — cancellation is idempotent; re-run reconcile to finalize if possible.
    const result = commit(graph, state, [], ctx.at);
    if (!result.ok) return result;
    return ok(step(state.runId, result.value));
  }
  const result = commit(
    graph,
    state,
    [{ at: ctx.at, kind: 'cancellation.requested', detail: { reason } }],
    ctx.at,
  );
  if (!result.ok) return result;
  return ok(step(state.runId, result.value));
}

/**
 * Advance time: convert every running node whose injected TIMEOUT deadline has elapsed into a
 * `timeout` failure and run it through the retry orchestrator. No timer fires — the caller
 * injects `now`, and the coordinator reacts deterministically to it (Timeout State tracking).
 */
export function tick(
  graph: ExecutionGraph,
  state: ExecutionState,
  ctx: CoordinatorContext,
): Result<CoordinatorStep, CoordinatorError> {
  let current = state;
  const entries: JournalEntry[] = [];
  for (const nodeId of dueTimeouts(graph, state, ctx.at)) {
    const node = current.nodes[nodeId];
    if (node === undefined || node.state !== 'running') continue;
    const failure = stepFailure('timeout', `Node "${nodeId}" exceeded its timeout budget`);
    const specs = failureSpecs(graph, current, nodeId, failure, node.attempt, ctx.at);
    const result = commit(graph, current, specs, ctx.at);
    if (!result.ok) return result;
    current = result.value.state;
    entries.push(...result.value.entries);
  }
  return ok(step(state.runId, { state: current, entries }));
}
