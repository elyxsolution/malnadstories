import type { CancellationSignal } from '@workerv2/processing';
import type { Timestamp } from '@workerv2/control-plane';
import type { Clock } from './contracts.js';
import { ProcessorAbort } from './errors.js';

/**
 * RESOURCE GUARDS — the cooperative checks a processor calls at safe points to RESPECT
 * cancellation and deadlines. Purely declarative: cancellation is polled from the injected
 * `CancellationSignal` (engine-owned), and the deadline is compared against an INJECTED clock —
 * the SDK reads no ambient time and arms no timer. Tripping a guard raises a `ProcessorAbort`
 * (`cancelled` / `timeout`) that the base processor turns into the matching `StepFailure`.
 */
export class ResourceGuard {
  constructor(
    private readonly cancellation: CancellationSignal,
    private readonly deadlineAt?: Timestamp,
    private readonly clock?: Clock,
  ) {}

  /** Whether cancellation has been requested. */
  get cancelled(): boolean {
    return this.cancellation.isCancelled();
  }

  /** The cancellation reason, once requested. */
  get cancellationReason(): string | null {
    return this.cancellation.reason();
  }

  /** The attempt's deadline, if the host set one. */
  get deadline(): Timestamp | undefined {
    return this.deadlineAt;
  }

  /** Milliseconds remaining until the deadline (needs a deadline + clock); `undefined` if unbounded. */
  remainingMs(): number | undefined {
    if (this.deadlineAt === undefined || this.clock === undefined) return undefined;
    return Date.parse(this.deadlineAt) - Date.parse(this.clock());
  }

  /** Whether the deadline has been reached (false when unbounded). */
  get expired(): boolean {
    const remaining = this.remainingMs();
    return remaining !== undefined && remaining <= 0;
  }

  /** Abort with `cancelled` if cancellation has been requested. */
  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new ProcessorAbort('cancelled', `Cancelled: ${this.cancellationReason ?? 'requested'}`);
    }
  }

  /** Abort with `timeout` if the deadline has been reached. */
  throwIfExpired(): void {
    if (this.expired) {
      throw new ProcessorAbort('timeout', 'Deadline exceeded before completion');
    }
  }

  /** Check BOTH cancellation and the deadline — the guard a processor calls between work units. */
  check(): void {
    this.throwIfCancelled();
    this.throwIfExpired();
  }
}
