import type { Timestamp } from '@workerv2/control-plane';
import type { Clock, MutableClock, Waiter } from './contracts.js';

/**
 * Reference TIME implementations. `systemClock` is the ONE place wall-clock time enters the
 * adapter (isolated, injectable, obvious). `manualClock` is the deterministic double — the
 * whole adapter becomes reproducible when driven by it, which is how we prove the Coordinator's
 * decisions are unchanged.
 */

/** The real wall-clock. The single ambient-time reference in the package. */
export const systemClock: Clock = {
  now: (): Timestamp => new Date().toISOString() as Timestamp,
};

/** A clock whose time is set explicitly — deterministic for tests and controlled hosts. */
export function manualClock(start: Timestamp): MutableClock {
  let current = start;
  return {
    now: (): Timestamp => current,
    set: (at: Timestamp): void => {
      current = at;
    },
  };
}

/**
 * A waiter that returns immediately — for deterministic tests and hosts that advance their own
 * clock. It does NOT sleep; retry-backoff `readyAt` gating still holds because the driver only
 * re-dispatches once the injected clock reaches the deadline.
 */
export const immediateWaiter: Waiter = {
  waitUntil: (): Promise<void> => Promise.resolve(),
};

/**
 * A deterministic waiter that advances a `MutableClock` to the deadline instead of sleeping —
 * lets a single-process driver honour retry backoff in tests without wall-clock delay or timers.
 * A real host supplies its own wall-clock waiter (a one-line `setTimeout` wrapper); the adapter
 * ships none, so it stays timer-free.
 */
export function clockAdvancingWaiter(clock: MutableClock): Waiter {
  return {
    waitUntil: (deadline: Timestamp): Promise<void> => {
      clock.set(deadline);
      return Promise.resolve();
    },
  };
}
