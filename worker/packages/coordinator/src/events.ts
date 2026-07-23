import type { JsonObject } from '@workerv2/contracts';
import type { StepId } from '@workerv2/processing';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { JournalEntry } from './journal.js';

/**
 * EXECUTION EVENT PUBLICATION CONTRACTS — the technical/operational events the coordinator
 * PUBLISHES as it drives a run, distinct from the domain lifecycle events the Control Plane's
 * Run aggregate owns (INV-12: technical vs domain streams stay separate). These describe
 * orchestration mechanics (a node was dispatched, a retry was scheduled, the run drained) and
 * carry NO transport assumption: the coordinator RETURNS events from every command, and an
 * adapter forwards them to whatever bus it uses (in-process, queue-backed, distributed).
 *
 * Events are DERIVED from journal entries (one event per entry), so the published stream and
 * the recorded history can never disagree — the journal is the single source of truth.
 */
export type ExecutionEventType = `execution.${string}`;

export interface ExecutionEvent {
  readonly kind: 'execution';
  readonly type: ExecutionEventType;
  readonly runId: RunId;
  /** The run-scoped sequence number of the originating journal entry (its identity). */
  readonly seq: number;
  readonly at: Timestamp;
  readonly node?: StepId;
  readonly payload?: JsonObject;
}

/**
 * The seam an infrastructure adapter implements to forward execution events onto a bus. The
 * coordinator NEVER calls this itself (it stays pure and returns events); the contract exists
 * so adapters share one publication shape. Framework-independent — no transport implied.
 */
export interface ExecutionEventPublisher {
  publish(event: ExecutionEvent): void;
}

/** Map a journal entry to its published execution event (pure; `execution.<journal kind>`). */
export function toExecutionEvent(runId: RunId, entry: JournalEntry): ExecutionEvent {
  const base = {
    kind: 'execution' as const,
    type: `execution.${entry.kind}` as ExecutionEventType,
    runId,
    seq: entry.seq,
    at: entry.at,
  };
  return Object.freeze({
    ...base,
    ...(entry.node === undefined ? {} : { node: entry.node }),
    ...(entry.detail === undefined ? {} : { payload: entry.detail }),
  });
}

/** Map a batch of journal entries to execution events, preserving order. */
export function toExecutionEvents(
  runId: RunId,
  entries: readonly JournalEntry[],
): readonly ExecutionEvent[] {
  return entries.map((entry) => toExecutionEvent(runId, entry));
}
