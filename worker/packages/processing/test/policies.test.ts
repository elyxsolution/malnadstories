import { describe, expect, it } from 'vitest';
import {
  NO_RETRY,
  validateRetryPolicy,
  delayBeforeAttempt,
  validateTimeoutPolicy,
  DEFAULT_CANCELLATION,
  NEVER_CANCELLED,
  validateCancellationPolicy,
  DEFAULT_FAILURE_POLICY,
  validateFailurePolicy,
  stepFailure,
  planFailureAction,
} from '@workerv2/processing';
import type { RetryPolicy } from '@workerv2/processing';

describe('retry model (declarative)', () => {
  it('accepts NO_RETRY and sensible policies', () => {
    expect(validateRetryPolicy(NO_RETRY).ok).toBe(true);
    expect(validateRetryPolicy({ maxAttempts: 3, backoff: 'fixed', initialDelayMs: 100 }).ok).toBe(
      true,
    );
    expect(
      validateRetryPolicy({
        maxAttempts: 5,
        backoff: 'exponential',
        initialDelayMs: 200,
        maxDelayMs: 5_000,
        multiplier: 3,
      }).ok,
    ).toBe(true);
  });

  it('rejects malformed policies', () => {
    expect(validateRetryPolicy({ maxAttempts: 0, backoff: 'none', initialDelayMs: 0 }).ok).toBe(
      false,
    );
    expect(validateRetryPolicy({ maxAttempts: 1.5, backoff: 'none', initialDelayMs: 0 }).ok).toBe(
      false,
    );
    expect(validateRetryPolicy({ maxAttempts: 101, backoff: 'none', initialDelayMs: 0 }).ok).toBe(
      false,
    );
    // 'none' with a delay / delayed backoff without a delay
    expect(validateRetryPolicy({ maxAttempts: 2, backoff: 'none', initialDelayMs: 5 }).ok).toBe(
      false,
    );
    expect(validateRetryPolicy({ maxAttempts: 2, backoff: 'fixed', initialDelayMs: 0 }).ok).toBe(
      false,
    );
    // maxDelay below initial; multiplier on non-exponential; multiplier < 1
    expect(
      validateRetryPolicy({ maxAttempts: 2, backoff: 'fixed', initialDelayMs: 100, maxDelayMs: 50 })
        .ok,
    ).toBe(false);
    expect(
      validateRetryPolicy({ maxAttempts: 2, backoff: 'fixed', initialDelayMs: 100, multiplier: 2 })
        .ok,
    ).toBe(false);
    expect(
      validateRetryPolicy({
        maxAttempts: 2,
        backoff: 'exponential',
        initialDelayMs: 100,
        multiplier: 0.5,
      }).ok,
    ).toBe(false);
  });

  it('computes deterministic exponential delays with a cap — pure math, no waiting', () => {
    const policy: RetryPolicy = {
      maxAttempts: 5,
      backoff: 'exponential',
      initialDelayMs: 100,
      maxDelayMs: 500,
    };
    expect(delayBeforeAttempt(policy, 2)).toBe(100); // 100 * 2^0
    expect(delayBeforeAttempt(policy, 3)).toBe(200); // 100 * 2^1
    expect(delayBeforeAttempt(policy, 4)).toBe(400); // 100 * 2^2
    expect(delayBeforeAttempt(policy, 5)).toBe(500); // capped from 800
    expect(delayBeforeAttempt(policy, 6)).toBeNull(); // budget exhausted
    expect(delayBeforeAttempt(policy, 1)).toBeNull(); // attempt 1 is not a retry
  });

  it('fixed backoff repeats the initial delay; none has zero delay', () => {
    const fixed: RetryPolicy = { maxAttempts: 3, backoff: 'fixed', initialDelayMs: 250 };
    expect(delayBeforeAttempt(fixed, 2)).toBe(250);
    expect(delayBeforeAttempt(fixed, 3)).toBe(250);
    const none: RetryPolicy = { maxAttempts: 2, backoff: 'none', initialDelayMs: 0 };
    expect(delayBeforeAttempt(none, 2)).toBe(0);
  });
});

describe('timeout model (declarative)', () => {
  it('accepts valid budgets', () => {
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 30_000 }).ok).toBe(true);
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 30_000, overallTimeoutMs: 120_000 }).ok).toBe(
      true,
    );
  });

  it('rejects invalid budgets', () => {
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 0 }).ok).toBe(false);
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 1.2 }).ok).toBe(false);
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 25 * 60 * 60 * 1000 }).ok).toBe(false);
    expect(validateTimeoutPolicy({ attemptTimeoutMs: 10_000, overallTimeoutMs: 5_000 }).ok).toBe(
      false,
    );
  });
});

describe('cancellation model (declarative + signal contract)', () => {
  it('accepts the default and valid policies', () => {
    expect(validateCancellationPolicy(DEFAULT_CANCELLATION).ok).toBe(true);
    expect(validateCancellationPolicy({ mode: 'unsupported' }).ok).toBe(true);
    expect(validateCancellationPolicy({ mode: 'abortive' }).ok).toBe(true);
  });

  it('rejects a grace period outside cooperative mode or out of range', () => {
    expect(validateCancellationPolicy({ mode: 'abortive', gracePeriodMs: 100 }).ok).toBe(false);
    expect(validateCancellationPolicy({ mode: 'cooperative', gracePeriodMs: -1 }).ok).toBe(false);
    expect(
      validateCancellationPolicy({ mode: 'cooperative', gracePeriodMs: 11 * 60 * 1000 }).ok,
    ).toBe(false);
  });

  it('NEVER_CANCELLED is inert and frozen', () => {
    expect(NEVER_CANCELLED.isCancelled()).toBe(false);
    expect(NEVER_CANCELLED.reason()).toBeNull();
    expect(Object.isFrozen(NEVER_CANCELLED)).toBe(true);
  });
});

describe('failure model — pure planned-action decisions (nothing executed)', () => {
  const retry: RetryPolicy = { maxAttempts: 3, backoff: 'fixed', initialDelayMs: 100 };

  it('validates policies (onPermanent locked to fail)', () => {
    expect(validateFailurePolicy(DEFAULT_FAILURE_POLICY).ok).toBe(true);
    expect(
      validateFailurePolicy({
        onTransient: 'retry',
        onTimeout: 'fail',
        onPermanent: 'fail',
      }).ok,
    ).toBe(true);
    expect(
      validateFailurePolicy({
        onTransient: 'retry',
        onTimeout: 'retry',
        // @ts-expect-error — the type forbids it; the runtime guard must too
        onPermanent: 'retry',
      }).ok,
    ).toBe(false);
  });

  it('transient within budget → retry with the computed delay + next attempt', () => {
    const planned = planFailureAction(
      stepFailure('transient', 'blip'),
      1,
      retry,
      DEFAULT_FAILURE_POLICY,
    );
    expect(planned).toStrictEqual({ action: 'retry', nextAttempt: 2, delayMs: 100 });
  });

  it('transient with exhausted budget → fail', () => {
    const planned = planFailureAction(
      stepFailure('transient', 'blip'),
      3,
      retry,
      DEFAULT_FAILURE_POLICY,
    );
    expect(planned).toStrictEqual({ action: 'fail' });
  });

  it('permanent → fail regardless of budget; cancelled → cancelled', () => {
    expect(
      planFailureAction(stepFailure('permanent', 'bad input'), 1, retry, DEFAULT_FAILURE_POLICY),
    ).toStrictEqual({ action: 'fail' });
    expect(
      planFailureAction(stepFailure('cancelled', 'user abort'), 1, retry, DEFAULT_FAILURE_POLICY),
    ).toStrictEqual({ action: 'cancelled' });
  });

  it('timeout honors the policy switch', () => {
    expect(
      planFailureAction(stepFailure('timeout', 'slow'), 1, retry, DEFAULT_FAILURE_POLICY),
    ).toStrictEqual({ action: 'retry', nextAttempt: 2, delayMs: 100 });
    expect(
      planFailureAction(stepFailure('timeout', 'slow'), 1, retry, {
        onTransient: 'retry',
        onTimeout: 'fail',
        onPermanent: 'fail',
      }),
    ).toStrictEqual({ action: 'fail' });
  });

  it('stepFailure records are frozen and JSON-safe', () => {
    const failure = stepFailure('transient', 'blip', { attempt: 1 });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(JSON.parse(JSON.stringify(failure))).toStrictEqual({
      kind: 'transient',
      message: 'blip',
      context: { attempt: 1 },
    });
  });
});
