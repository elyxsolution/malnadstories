import { describe, expect, it } from 'vitest';
import { NEVER_CANCELLED } from '@workerv2/processing';
import {
  InMemoryArtifactGateway,
  ProcessorAbort,
  ProcessorHarness,
  ResourceGuard,
  abortPermanent,
  abortTransient,
  requireConfig,
} from '@workerv2/processor-sdk';
import { at, cancelledSignal, parsePositiveTimes, uppercaseSpec } from './helpers.js';

describe('resource guards — cancellation + deadlines', () => {
  it('aborts with `cancelled` when cancellation is requested', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(uppercaseSpec, {
      inputs: { text: harness.seedText('x') },
      expectedOutputs: ['result'],
      cancellation: cancelledSignal('stop'),
    });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('cancelled');
    expect(result.outcome.error.message).toContain('Cancelled');
  });

  it('aborts with `timeout` when the deadline has elapsed', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(uppercaseSpec, {
      inputs: { text: harness.seedText('x') },
      expectedOutputs: ['result'],
      clock: () => at(5000),
      deadline: at(1000),
    });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('timeout');
    expect(result.outcome.error.message).toContain('Deadline exceeded');
  });

  it('ResourceGuard computes remaining time and expiry from the injected clock', () => {
    const guard = new ResourceGuard(NEVER_CANCELLED, at(1000), () => at(400));
    expect(guard.remainingMs()).toBe(600);
    expect(guard.expired).toBe(false);
    expect(() => guard.check()).not.toThrow();

    const expiredGuard = new ResourceGuard(NEVER_CANCELLED, at(1000), () => at(1500));
    expect(expiredGuard.expired).toBe(true);
    expect(() => expiredGuard.throwIfExpired()).toThrow(ProcessorAbort);

    const cancelledGuard = new ResourceGuard(cancelledSignal());
    expect(cancelledGuard.remainingMs()).toBeUndefined(); // unbounded
    expect(() => cancelledGuard.throwIfCancelled()).toThrow(ProcessorAbort);
  });
});

describe('artifact gateway (reference)', () => {
  it('reads what it wrote and rejects a missing key', async () => {
    const gateway = new InMemoryArtifactGateway();
    const key = gateway.seedText('payload');
    expect(new TextDecoder().decode(await gateway.read(key))).toBe('payload');
    expect(await gateway.exists(key)).toBe(true);
    await expect(gateway.read('mem:deadbeef' as never)).rejects.toThrow('No artifact');
  });
});

describe('abort helpers + config validation', () => {
  it('abortPermanent / abortTransient carry the right failure kind', () => {
    expect(() => abortPermanent('nope')).toThrow(ProcessorAbort);
    try {
      abortTransient('later');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessorAbort);
      expect((error as ProcessorAbort).failureKind).toBe('transient');
    }
  });

  it('requireConfig returns the parsed value or aborts permanently', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(
      {
        descriptor: { name: 'cfg', version: '1.0.0' },
        execute: async (ctx) => {
          const times = requireConfig(ctx, parsePositiveTimes);
          return { out: await ctx.produceText(String(times)) };
        },
      },
      { config: { times: 4 }, expectedOutputs: ['out'] },
    );
    expect(result.outputText('out')).toBe('4');

    const bad = await harness.execute(
      {
        descriptor: { name: 'cfg', version: '1.0.0' },
        execute: async (ctx) => ({
          out: await ctx.produceText(String(requireConfig(ctx, parsePositiveTimes))),
        }),
      },
      { config: { times: 'nope' }, expectedOutputs: ['out'] },
    );
    expect(bad.outcome.ok).toBe(false);
    if (!bad.outcome.ok) expect(bad.outcome.error.kind).toBe('permanent');
  });
});
