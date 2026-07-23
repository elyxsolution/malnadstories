import { describe, expect, it } from 'vitest';
import { ProcessorHarness } from '@workerv2/processor-sdk';
import { mergeSpec, repeatSpec, uppercaseSpec } from './helpers.js';

describe('processor harness — running artifact transforms', () => {
  it('runs a processor end to end: reads an input Artifact, produces an output Artifact', async () => {
    const harness = new ProcessorHarness();
    const text = harness.seedText('hello world');

    const result = await harness.execute(uppercaseSpec, {
      inputs: { text },
      expectedOutputs: ['result'],
    });

    expect(result.outcome.ok).toBe(true);
    expect(result.outputText('result')).toBe('HELLO WORLD');
    // The produced artifact really lives in the gateway (content-addressed).
    if (result.outcome.ok) {
      const key = result.outcome.value.outputs['result'];
      expect(key).toBeDefined();
      expect(harness.artifacts.text(key as never)).toBe('HELLO WORLD');
    }
  });

  it('captures progress reports (with attempt identity) and diagnostics', async () => {
    const harness = new ProcessorHarness();
    const text = harness.seedText('hi');
    const result = await harness.execute(uppercaseSpec, {
      inputs: { text },
      expectedOutputs: ['result'],
    });

    // The lifecycle reports validate → execute → finalize, plus the processor's own update.
    expect(result.progress.map((p) => p.phase)).toEqual([
      'validate',
      'execute',
      'execute',
      'finalize',
    ]);
    expect(result.progress.at(-1)?.fraction).toBe(1);
    expect(result.progress.some((p) => p.message === 'transforming')).toBe(true);
    expect(result.progress.every((p) => p.runId === 'run-1' && p.stepId === 'step-1')).toBe(true);

    // Diagnostics: a debug at start and an info at completion.
    expect(result.diagnostics[0]?.level).toBe('debug');
    expect(result.diagnostics.at(-1)?.level).toBe('info');
  });

  it('reads multiple inputs and merges them', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(mergeSpec, {
      inputs: { a: harness.seedText('foo'), b: harness.seedText('bar') },
      expectedOutputs: ['out'],
    });
    expect(result.outputText('out')).toBe('foobar');
  });

  it('uses validated config', async () => {
    const harness = new ProcessorHarness();
    const result = await harness.execute(repeatSpec, {
      inputs: { text: harness.seedText('ab') },
      config: { times: 3 },
      expectedOutputs: ['result'],
    });
    expect(result.outputText('result')).toBe('ababab');
  });

  it('produces identical keys for identical content (content-addressed, idempotent)', async () => {
    const harness = new ProcessorHarness();
    const a = harness.seedText('same');
    const b = await harness.artifacts.write(new TextEncoder().encode('same'));
    expect(b).toBe(a);
    expect(harness.artifacts.count).toBe(1);
  });
});
