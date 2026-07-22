import type { JsonObject, Result } from '@workerv2/contracts';
import { ok, err, assertNever } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { RetryPolicy } from './retry.js';
import { delayBeforeAttempt } from './retry.js';

/**
 * The FAILURE model — the declarative vocabulary for how a step attempt ends badly, and the
 * pure decision function a future engine uses to interpret it. Nothing is executed here.
 */

/** How an attempt failed. The kind — not the message — drives the planned reaction. */
export type FailureKind =
  | 'transient' // dependency hiccup, contention — the kind retries exist for
  | 'permanent' // invalid input, integrity violation — retrying cannot help
  | 'timeout' // the attempt exceeded its TimeoutPolicy budget
  | 'cancelled'; // cancellation was requested and took effect

export const FAILURE_KINDS: readonly FailureKind[] = [
  'transient',
  'permanent',
  'timeout',
  'cancelled',
];

/** An immutable record of one failed attempt (JSON-safe; no secrets/PII in `context`). */
export interface StepFailure {
  readonly kind: FailureKind;
  readonly message: string;
  readonly context?: JsonObject;
}

export function stepFailure(kind: FailureKind, message: string, context?: JsonObject): StepFailure {
  return Object.freeze(context === undefined ? { kind, message } : { kind, message, context });
}

/**
 * The declarative reaction to each failure kind. `retry` is always subject to the step's
 * `RetryPolicy` budget — a kind marked `retry` with an exhausted budget still fails.
 * `cancelled` is not configurable: cancellation always ends the step as cancelled.
 */
export interface FailurePolicy {
  readonly onTransient: 'retry' | 'fail';
  readonly onTimeout: 'retry' | 'fail';
  readonly onPermanent: 'fail'; // permanent failures are never retried — by definition
}

export const DEFAULT_FAILURE_POLICY: FailurePolicy = Object.freeze({
  onTransient: 'retry',
  onTimeout: 'retry',
  onPermanent: 'fail',
} as FailurePolicy);

export function validateFailurePolicy(
  policy: FailurePolicy,
): Result<FailurePolicy, ValidationError> {
  const reactions: readonly string[] = ['retry', 'fail'];
  if (
    !reactions.includes(policy.onTransient) ||
    !reactions.includes(policy.onTimeout) ||
    policy.onPermanent !== 'fail'
  ) {
    return err(
      new ValidationError(
        "FailurePolicy reactions must be 'retry'|'fail' (onPermanent is always 'fail')",
        { context: { policy: { ...policy } } },
      ),
    );
  }
  return ok(policy);
}

/**
 * The PLANNED next action after a failed attempt — pure decision logic shared by every future
 * engine (local, distributed, replay), so retry semantics can never drift between them.
 * Deterministic: (policies, failure kind, attempt number) → action. Executes nothing.
 */
export type PlannedFailureAction =
  | { readonly action: 'retry'; readonly nextAttempt: number; readonly delayMs: number }
  | { readonly action: 'fail' }
  | { readonly action: 'cancelled' };

export function planFailureAction(
  failure: StepFailure,
  attempt: number,
  retry: RetryPolicy,
  policy: FailurePolicy,
): PlannedFailureAction {
  switch (failure.kind) {
    case 'cancelled':
      return { action: 'cancelled' };
    case 'permanent':
      return { action: 'fail' };
    case 'transient':
      return policy.onTransient === 'retry' ? tryRetry(retry, attempt) : { action: 'fail' };
    case 'timeout':
      return policy.onTimeout === 'retry' ? tryRetry(retry, attempt) : { action: 'fail' };
    default:
      return assertNever(failure.kind);
  }
}

function tryRetry(retry: RetryPolicy, attempt: number): PlannedFailureAction {
  const nextAttempt = attempt + 1;
  const delayMs = delayBeforeAttempt(retry, nextAttempt);
  if (delayMs === null) return { action: 'fail' }; // budget exhausted
  return { action: 'retry', nextAttempt, delayMs };
}
