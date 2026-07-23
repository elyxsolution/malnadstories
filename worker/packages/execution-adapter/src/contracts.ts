import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { ExecutionEvent, JournalEntry } from '@workerv2/coordinator';

/**
 * ADAPTER CONTRACTS — the replaceable seams every side effect flows through. The Coordinator is
 * pure; the adapter is where time, persistence, and publication actually happen, and each is an
 * INTERFACE so a single-process, distributed, or queue-backed adapter can swap the concrete
 * implementation WITHOUT touching the Coordinator's public API. The adapter ships small,
 * dependency-free reference implementations; production hosts inject their own.
 *
 * None of these imply a transport, database, queue, or network — they are the minimal seams the
 * effect loop needs: read the injected time, append to a journal, and publish an event.
 */

/** The injected TIME source. The Coordinator never reads a clock; the adapter reads it here. */
export interface Clock {
  now(): Timestamp;
}

/** A `Clock` whose current time can be moved forward — the deterministic test/host double. */
export interface MutableClock extends Clock {
  set(at: Timestamp): void;
}

/**
 * The WAIT seam used between retry-backoff sweeps: when the only remaining work is gated by a
 * future `readyAt`, the driver asks the waiter to advance to it. Kept an interface so waiting is
 * deterministic in tests (advance an injected clock) and a real host can supply wall-clock
 * waiting — the adapter itself arms no timer.
 */
export interface Waiter {
  waitUntil(deadline: Timestamp, now: Timestamp): Promise<void>;
}

/**
 * The JOURNAL PERSISTENCE interface — append-only. The adapter persists the Coordinator's
 * journal entries through this seam; it never talks to a database directly. `load` supports
 * resume (re-fold a persisted journal). Ordering within a run is the caller's append order,
 * which is the Coordinator's contiguous sequence.
 */
export interface JournalStore {
  append(runId: RunId, entries: readonly JournalEntry[]): Promise<void>;
  load(runId: RunId): Promise<readonly JournalEntry[]>;
}

/**
 * The EVENT SINK interface — where execution events are published. Replaceable: an in-memory
 * collector for tests, a bus/queue publisher in production. Returns `void` or a promise so both
 * synchronous and asynchronous sinks fit; the adapter awaits it.
 */
export interface EventSink {
  publish(event: ExecutionEvent): void | Promise<void>;
}
