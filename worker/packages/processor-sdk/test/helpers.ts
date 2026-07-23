import type { JsonObject, Result } from '@workerv2/contracts';
import type { Timestamp } from '@workerv2/control-plane';
import { makeTimestamp } from '@workerv2/control-plane';
import type { CancellationSignal } from '@workerv2/processing';
import { ensure } from '@workerv2/processor-sdk';
import type { ProcessorSpec } from '@workerv2/processor-sdk';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function at(ms: number): Timestamp {
  return unwrap(makeTimestamp(new Date(Date.UTC(2026, 0, 1) + ms)));
}

/** An always-cancelled signal for guard tests. */
export function cancelledSignal(reason = 'user requested'): CancellationSignal {
  return { isCancelled: (): boolean => true, reason: (): string | null => reason };
}

// --- Sample TEST-ONLY processors (the SDK ships none; these prove the framework) ---

/** Reads `text`, produces `result` uppercased. */
export const uppercaseSpec: ProcessorSpec = {
  descriptor: { name: 'text.uppercase', version: '1.0.0' },
  requiredInputs: ['text'],
  execute: async (ctx) => {
    const input = await ctx.readText('text');
    ctx.reportProgress({ fraction: 0.5, message: 'transforming', phase: 'execute' });
    return { result: await ctx.produceText(input.toUpperCase(), { kind: 'derivative' }) };
  },
};

/** Reads `a` and `b`, produces `out` = a + b. */
export const mergeSpec: ProcessorSpec = {
  descriptor: { name: 'text.merge', version: '1.0.0' },
  requiredInputs: ['a', 'b'],
  execute: async (ctx) => {
    const a = await ctx.readText('a');
    const b = await ctx.readText('b');
    return { out: await ctx.produceText(a + b) };
  },
};

/** Config-driven: repeats `text` `config.times` times; validates config. */
export const repeatSpec: ProcessorSpec = {
  descriptor: { name: 'text.repeat', version: '1.0.0' },
  requiredInputs: ['text'],
  validate: (ctx): void => {
    const times = ctx.config['times'];
    ensure(typeof times === 'number' && times > 0, 'config.times must be a positive number');
  },
  execute: async (ctx) => {
    const text = await ctx.readText('text');
    const times = ctx.config['times'] as number;
    return { result: await ctx.produceText(text.repeat(times)) };
  },
};

/** Checks the guard in a loop before copying `text` to `result` (respects cancellation/deadline). */
export const guardedCopySpec: ProcessorSpec = {
  descriptor: { name: 'text.guardedcopy', version: '1.0.0' },
  requiredInputs: ['text'],
  execute: async (ctx) => {
    for (let i = 0; i < 3; i += 1) ctx.guard.check();
    return { result: await ctx.produceText(await ctx.readText('text')) };
  },
};

/** Always throws (an unexpected error, not a declared abort). */
export const throwingSpec: ProcessorSpec = {
  descriptor: { name: 'boom', version: '1.0.0' },
  execute: async () => {
    throw new Error('kaboom');
  },
};

/** A pure config parser for `requireConfig` tests. */
export function parsePositiveTimes(config: JsonObject): Result<number, string> {
  const times = config['times'];
  if (typeof times !== 'number' || !Number.isInteger(times) || times <= 0) {
    return { ok: false, error: 'times must be a positive integer' };
  }
  return { ok: true, value: times };
}
