import { describe, expect, it } from 'vitest';
import { ProcessorHarness } from '@workerv2/processor-sdk';
import { repeatSpec, throwingSpec, uppercaseSpec } from './helpers.js';

describe('processor lifecycle + validation (failures become in-band StepFailures)', () => {
  it('fails permanently when a required input is missing', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(uppercaseSpec, {
      inputs: {},
      expectedOutputs: ['result'],
    });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('permanent');
    expect(result.outcome.error.message).toContain('Missing required input');
  });

  it('fails permanently when config validation aborts', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(repeatSpec, {
      inputs: { text: harness.seedText('x') },
      config: { times: -1 },
      expectedOutputs: ['result'],
    });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('permanent');
    expect(result.outcome.error.message).toContain('positive number');
  });

  it('fails permanently when produced outputs do not match the declared slots', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(uppercaseSpec, {
      inputs: { text: harness.seedText('x') },
      expectedOutputs: ['wrong-slot'], // the processor produces `result`, not `wrong-slot`
    });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('permanent');
    expect(result.outcome.error.message).toContain('do not match the declared slots');
  });

  it('normalizes an unexpected thrown error into a transient failure', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(throwingSpec, { expectedOutputs: [] });
    expect(result.outcome.ok).toBe(false);
    if (result.outcome.ok) return;
    expect(result.outcome.error.kind).toBe('transient');
    expect(result.outcome.error.message).toContain('kaboom');
  });

  it('emits a warning diagnostic on failure', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(uppercaseSpec, {
      inputs: {},
      expectedOutputs: ['result'],
    });
    expect(result.diagnostics.some((d) => d.level === 'warning')).toBe(true);
  });
});
