import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * The CANCELLATION model — a declarative policy plus the read-only signal CONTRACT a future
 * engine implements. Nothing here cancels anything.
 *
 * - `unsupported` — the step cannot be cancelled once started; the engine waits it out.
 * - `cooperative` — the processor observes `CancellationSignal` and stops at a safe point
 *   within `gracePeriodMs`.
 * - `abortive` — the engine may terminate the attempt immediately (safe because handlers are
 *   idempotent, INV-7, and artifacts are write-once, INV-2 — a killed attempt leaves no
 *   corruptible state).
 */
export interface CancellationPolicy {
  readonly mode: 'unsupported' | 'cooperative' | 'abortive';
  /** Only meaningful for 'cooperative': how long the engine allows for a graceful stop. */
  readonly gracePeriodMs?: number;
}

/** The default: cooperative cancellation with a short grace period. */
export const DEFAULT_CANCELLATION: CancellationPolicy = Object.freeze({
  mode: 'cooperative',
  gracePeriodMs: 5_000,
} as CancellationPolicy);

/**
 * The read-only cancellation signal handed to processors via the `ProcessingContext`. A CONTRACT
 * only — the engine owns the implementation; the framework ships none (no execution behavior).
 * `isCancelled()` is a poll — cooperative processors check it at safe points.
 */
export interface CancellationSignal {
  isCancelled(): boolean;
  /** Why cancellation was requested, once it has been (JSON-safe, for the failure record). */
  reason(): string | null;
}

/** A permanently-uncancelled signal — the neutral value for contexts built outside an engine. */
export const NEVER_CANCELLED: CancellationSignal = Object.freeze({
  isCancelled: (): boolean => false,
  reason: (): string | null => null,
});

const MAX_GRACE_MS = 10 * 60 * 1000;

export function validateCancellationPolicy(
  policy: CancellationPolicy,
): Result<CancellationPolicy, ValidationError> {
  const bad = (message: string): Result<CancellationPolicy, ValidationError> =>
    err(new ValidationError(message, { context: { policy: { ...policy } } }));

  if (policy.mode !== 'cooperative' && policy.gracePeriodMs !== undefined) {
    return bad("CancellationPolicy.gracePeriodMs is only valid for 'cooperative' mode");
  }
  if (policy.gracePeriodMs !== undefined) {
    if (
      !Number.isInteger(policy.gracePeriodMs) ||
      policy.gracePeriodMs < 0 ||
      policy.gracePeriodMs > MAX_GRACE_MS
    ) {
      return bad(`CancellationPolicy.gracePeriodMs must be an integer in [0, ${MAX_GRACE_MS}]`);
    }
  }
  return ok(policy);
}
