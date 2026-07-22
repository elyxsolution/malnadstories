import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * The TIMEOUT model — declarative only. The framework validates bounds; a future execution
 * engine enforces them (no timer is ever armed here). A timeout that fires is reported through
 * the failure model as `kind: 'timeout'`, which the step's `FailurePolicy` then classifies.
 */
export interface TimeoutPolicy {
  /** Wall-clock budget for one attempt of the step. */
  readonly attemptTimeoutMs: number;
  /** Optional total budget across ALL attempts (must be >= attemptTimeoutMs). */
  readonly overallTimeoutMs?: number;
}

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h ceiling — a declaration guard, not a scheduler

export function validateTimeoutPolicy(
  policy: TimeoutPolicy,
): Result<TimeoutPolicy, ValidationError> {
  const bad = (message: string): Result<TimeoutPolicy, ValidationError> =>
    err(new ValidationError(message, { context: { policy: { ...policy } } }));

  if (!Number.isInteger(policy.attemptTimeoutMs) || policy.attemptTimeoutMs < 1) {
    return bad('TimeoutPolicy.attemptTimeoutMs must be an integer >= 1');
  }
  if (policy.attemptTimeoutMs > MAX_TIMEOUT_MS) {
    return bad(`TimeoutPolicy.attemptTimeoutMs must be <= ${MAX_TIMEOUT_MS}`);
  }
  if (policy.overallTimeoutMs !== undefined) {
    if (
      !Number.isInteger(policy.overallTimeoutMs) ||
      policy.overallTimeoutMs < policy.attemptTimeoutMs ||
      policy.overallTimeoutMs > MAX_TIMEOUT_MS
    ) {
      return bad(
        'TimeoutPolicy.overallTimeoutMs must be an integer within [attemptTimeoutMs, ceiling]',
      );
    }
  }
  return ok(policy);
}
