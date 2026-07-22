import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * The RETRY model — a fully DECLARATIVE policy (data, never behavior). The framework validates
 * policies and computes delays as pure math; it never waits, schedules, or retries anything —
 * a future execution engine interprets the policy (INV-5, INV-7-friendly: attempts are explicit).
 */
export interface RetryPolicy {
  /** Total attempts including the first (1 = no retries). */
  readonly maxAttempts: number;
  readonly backoff: 'none' | 'fixed' | 'exponential';
  /** Base delay before the first retry. Must be 0 when backoff is 'none'. */
  readonly initialDelayMs: number;
  /** Upper bound on any computed delay (exponential growth cap). */
  readonly maxDelayMs?: number;
  /** Exponential multiplier (default 2). Only meaningful for 'exponential'. */
  readonly multiplier?: number;
}

/** The no-retry policy (single attempt). */
export const NO_RETRY: RetryPolicy = Object.freeze({
  maxAttempts: 1,
  backoff: 'none',
  initialDelayMs: 0,
});

const MAX_ATTEMPTS_CEILING = 100;

export function validateRetryPolicy(policy: RetryPolicy): Result<RetryPolicy, ValidationError> {
  const bad = (message: string): Result<RetryPolicy, ValidationError> =>
    err(new ValidationError(message, { context: { policy: { ...policy } } }));

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    return bad('RetryPolicy.maxAttempts must be an integer >= 1');
  }
  if (policy.maxAttempts > MAX_ATTEMPTS_CEILING) {
    return bad(`RetryPolicy.maxAttempts must be <= ${MAX_ATTEMPTS_CEILING}`);
  }
  if (!Number.isInteger(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    return bad('RetryPolicy.initialDelayMs must be an integer >= 0');
  }
  if (policy.backoff === 'none' && policy.initialDelayMs !== 0) {
    return bad("RetryPolicy.initialDelayMs must be 0 when backoff is 'none'");
  }
  if (policy.backoff !== 'none' && policy.maxAttempts > 1 && policy.initialDelayMs === 0) {
    return bad('RetryPolicy.initialDelayMs must be > 0 for a delayed backoff');
  }
  if (policy.maxDelayMs !== undefined) {
    if (!Number.isInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
      return bad('RetryPolicy.maxDelayMs must be an integer >= initialDelayMs');
    }
  }
  if (policy.multiplier !== undefined) {
    if (policy.backoff !== 'exponential') {
      return bad("RetryPolicy.multiplier is only valid for 'exponential' backoff");
    }
    if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
      return bad('RetryPolicy.multiplier must be a finite number >= 1');
    }
  }
  return ok(policy);
}

/**
 * PURE delay computation for a retry that would precede attempt `attempt` (2-based: the delay
 * before attempt 2 is the first retry delay). Deterministic math only — no waiting happens here.
 * Returns `null` when `attempt` exceeds the policy's budget (no further retry is allowed).
 */
export function delayBeforeAttempt(policy: RetryPolicy, attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 2) return null;
  if (attempt > policy.maxAttempts) return null;
  if (policy.backoff === 'none') return 0;
  if (policy.backoff === 'fixed') return capDelay(policy, policy.initialDelayMs);
  const multiplier = policy.multiplier ?? 2;
  const raw = policy.initialDelayMs * Math.pow(multiplier, attempt - 2);
  return capDelay(policy, Math.round(raw));
}

function capDelay(policy: RetryPolicy, delay: number): number {
  return policy.maxDelayMs === undefined ? delay : Math.min(delay, policy.maxDelayMs);
}
