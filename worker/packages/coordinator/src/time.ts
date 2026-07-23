import type { Timestamp } from '@workerv2/control-plane';
import { compareTimestamps } from '@workerv2/control-plane';

/**
 * PURE time arithmetic for the coordinator. Time is an INJECTED value everywhere (every
 * command carries an `at: Timestamp`); nothing here reads the ambient clock (`Date.now`) and
 * NO timer is ever armed. Retry backoff and timeout deadlines are computed as deterministic
 * offsets of an injected timestamp — a future execution engine decides WHEN to feed the next
 * injected `now`, so the coordinator stays free of scheduling infrastructure.
 */

/** Add a whole-millisecond offset to an ISO timestamp, returning a normalized ISO timestamp. */
export function addMillis(at: Timestamp, ms: number): Timestamp {
  return new Date(Date.parse(at) + ms).toISOString() as Timestamp;
}

/** True when `deadline` is at or before `now` (a due timeout / an elapsed backoff). Pure. */
export function isDue(deadline: Timestamp, now: Timestamp): boolean {
  return compareTimestamps(deadline, now) <= 0;
}
