import type { Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { CancellationSignal, StepFailure } from '@workerv2/processing';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type {
  Coordinator,
  CoordinatorError,
  CoordinatorStep,
  DispatchResult,
  ExecutionState,
} from '@workerv2/coordinator';
import type { EventSink, JournalStore } from './contracts.js';
import { AdapterError } from './errors.js';

/**
 * The EXECUTION SESSION — one run's stateful holder, and the ONLY place a Coordinator step's
 * side effects are applied. Each method calls a PURE Coordinator command, then, on success:
 * advances the held `ExecutionState`, PERSISTS the produced journal entries through the
 * `JournalStore`, and PUBLISHES the produced events through the `EventSink`. The Coordinator
 * decides; the session records and announces. A Coordinator rejection (an out-of-sequence
 * command — a driver bug) becomes an `AdapterError`; a step's business FAILURE is not an
 * error here (it flows in-band through `reportFailure`).
 *
 * Persist-then-publish is deliberate: the journal is the source of truth (a re-fold reconstructs
 * state), so it is durable before any event announces the transition.
 */
export class ExecutionSession {
  private current: ExecutionState;

  constructor(
    readonly coordinator: Coordinator,
    readonly runId: RunId,
    private readonly journal: JournalStore,
    private readonly events: EventSink,
    initial?: ExecutionState,
  ) {
    this.current = initial ?? coordinator.initialize(runId);
  }

  /** The current execution state (immutable snapshot). */
  get state(): ExecutionState {
    return this.current;
  }

  /** Whether the run has reached a terminal lifecycle state. */
  get settled(): boolean {
    return this.coordinator.progress(this.current).settled;
  }

  /** Start a pending run. */
  async start(at: Timestamp): Promise<CoordinatorStep> {
    return this.apply(this.coordinator.start(this.current, { at }));
  }

  /** Dispatch a ready node, returning the resolved `ProcessingContext` for a processor. */
  async dispatch(
    nodeId: string,
    at: Timestamp,
    cancellation?: CancellationSignal,
  ): Promise<DispatchResult> {
    return this.apply(this.coordinator.dispatch(this.current, nodeId, { at }, cancellation));
  }

  /** Feed a successful attempt's outputs back into the Coordinator. */
  async reportSuccess(
    nodeId: string,
    outputs: Readonly<Record<string, StorageKey>>,
    at: Timestamp,
  ): Promise<CoordinatorStep> {
    return this.apply(this.coordinator.reportSuccess(this.current, nodeId, outputs, { at }));
  }

  /** Feed a failed attempt back into the Coordinator (retry orchestration is the Coordinator's). */
  async reportFailure(
    nodeId: string,
    failure: StepFailure,
    at: Timestamp,
  ): Promise<CoordinatorStep> {
    return this.apply(this.coordinator.reportFailure(this.current, nodeId, failure, { at }));
  }

  /** Advance injected time so elapsed timeout budgets become failures. */
  async tick(at: Timestamp): Promise<CoordinatorStep> {
    return this.apply(this.coordinator.tick(this.current, { at }));
  }

  /** Request cancellation of the whole run. */
  async requestCancellation(at: Timestamp, reason?: string): Promise<CoordinatorStep> {
    return this.apply(this.coordinator.requestCancellation(this.current, { at }, reason));
  }

  /** Apply one Coordinator step: advance state, persist journal, publish events. */
  private async apply<T extends CoordinatorStep>(result: Result<T, CoordinatorError>): Promise<T> {
    if (!result.ok) {
      throw new AdapterError(`Coordinator rejected a command: ${result.error.message}`, {
        cause: result.error,
      });
    }
    const step = result.value;
    this.current = step.state;
    await this.journal.append(this.runId, step.entries);
    for (const event of step.events) {
      await this.events.publish(event);
    }
    return step;
  }
}
