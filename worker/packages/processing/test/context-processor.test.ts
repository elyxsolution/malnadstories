import { describe, expect, it } from 'vitest';
import {
  makeProcessingContext,
  makePipelineId,
  makeStepId,
  validateProcessorOutputs,
  NEVER_CANCELLED,
  stepFailure,
} from '@workerv2/processing';
import type {
  CancellationSignal,
  Processor,
  ProcessingContext,
  ProcessorOutcome,
  StepCapabilityRequirement,
} from '@workerv2/processing';
import { makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { StorageKey } from '@workerv2/infra-contracts';
// Runtime is imported in TESTS ONLY to prove structural compatibility — the processing
// package itself never depends on the hosting framework.
import type { CapabilityRequirement } from '@workerv2/runtime';
import { unwrap } from './helpers.js';

const key = (s: string): StorageKey => s as StorageKey;

function contextSpec(): Parameters<typeof makeProcessingContext>[0] {
  return {
    runId: unwrap(makeRunId('run-1')),
    pipelineId: unwrap(makePipelineId('pl-1')),
    stepId: unwrap(makeStepId('step-1')),
    attempt: 1,
    inputs: { raw: key('sha256:aa11') },
    expectedOutputs: ['canonical'],
    config: { quality: 90 },
    versions: { imageEngine: '1.0.0' },
    startedAt: unwrap(makeTimestamp('2026-07-23T00:00:00Z')),
  };
}

describe('ProcessingContext — immutable, resolved, injected-time', () => {
  it('builds a frozen context with defaults (config/versions/cancellation)', () => {
    const context = unwrap(
      makeProcessingContext({ ...contextSpec(), config: undefined, versions: undefined }),
    );
    expect(context.config).toStrictEqual({});
    expect(context.versions).toStrictEqual({});
    expect(context.cancellation).toBe(NEVER_CANCELLED);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.inputs)).toBe(true);
    expect(Object.isFrozen(context.expectedOutputs)).toBe(true);
    expect(Object.isFrozen(context.config)).toBe(true);
  });

  it('rejects a non-positive / fractional attempt', () => {
    expect(makeProcessingContext({ ...contextSpec(), attempt: 0 }).ok).toBe(false);
    expect(makeProcessingContext({ ...contextSpec(), attempt: 1.5 }).ok).toBe(false);
  });

  it('does NOT freeze the engine-owned cancellation signal', () => {
    let cancelled = false;
    const signal: CancellationSignal = {
      isCancelled: () => cancelled,
      reason: () => (cancelled ? 'test' : null),
    };
    const context = unwrap(makeProcessingContext({ ...contextSpec(), cancellation: signal }));
    cancelled = true; // a live signal keeps working through the frozen context
    expect(context.cancellation.isCancelled()).toBe(true);
    expect(context.cancellation.reason()).toBe('test');
  });

  it('copies spec collections — later mutation of the spec cannot reach the context', () => {
    const spec = { ...contextSpec(), inputs: { raw: key('sha256:aa11') } };
    const context = unwrap(makeProcessingContext(spec));
    (spec.inputs as Record<string, StorageKey>).extra = key('sha256:bb22');
    expect(Object.keys(context.inputs)).toStrictEqual(['raw']);
  });
});

describe('processor contracts', () => {
  it('validateProcessorOutputs accepts an exact slot match', () => {
    expect(
      validateProcessorOutputs(['canonical', 'thumb'], {
        canonical: key('sha256:cc'),
        thumb: key('sha256:dd'),
      }).ok,
    ).toBe(true);
  });

  it('rejects missing, extra, and empty outputs', () => {
    expect(validateProcessorOutputs(['canonical'], {}).ok).toBe(false);
    expect(
      validateProcessorOutputs(['canonical'], {
        canonical: key('sha256:cc'),
        surprise: key('sha256:ee'),
      }).ok,
    ).toBe(false);
    expect(validateProcessorOutputs(['canonical'], { canonical: key(' ') }).ok).toBe(false);
  });

  it('a Processor is implementable against the contract alone (no engine needed)', async () => {
    const processor: Processor = {
      descriptor: { name: 'noop', version: '1.0.0' },
      process: async (context: ProcessingContext): Promise<ProcessorOutcome> => {
        if (context.cancellation.isCancelled()) {
          return { ok: false, error: stepFailure('cancelled', 'aborted') };
        }
        return { ok: true, value: { outputs: { canonical: key('sha256:ff') } } };
      },
    };
    const outcome = await processor.process(unwrap(makeProcessingContext(contextSpec())));
    expect(outcome.ok).toBe(true);
  });
});

describe('capability requirements — structural compatibility with the runtime seam', () => {
  it('a StepCapabilityRequirement IS a runtime CapabilityRequirement (compile-time proof)', () => {
    const stepReq: StepCapabilityRequirement = { name: 'image-engine', versionRange: '^1.0.0' };
    // Assignable in both directions — future engines feed step requirements straight into
    // the runtime's CapabilityNegotiator without any mapping layer.
    const runtimeReq: CapabilityRequirement = stepReq;
    const back: StepCapabilityRequirement = runtimeReq;
    expect(back).toStrictEqual(stepReq);
  });
});
