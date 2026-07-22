import type { Result } from '@workerv2/contracts';
import type {
  ProcessingPipeline,
  ProcessingPipelineSpec,
  ProcessingStepSpec,
} from '@workerv2/processing';
import { definePipeline } from '@workerv2/processing';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function unwrapErr<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error('unwrapErr() called on Ok');
  return r.error;
}

/** A minimal valid step spec, overridable per test. */
export function step(id: string, overrides: Partial<ProcessingStepSpec> = {}): ProcessingStepSpec {
  return { id, processor: `${id}-processor`, ...overrides };
}

/** A minimal valid pipeline spec around the given steps. */
export function pipelineSpec(
  steps: readonly ProcessingStepSpec[],
  overrides: Partial<ProcessingPipelineSpec> = {},
): ProcessingPipelineSpec {
  return { id: 'pl-1', version: '1.0.0', steps, ...overrides };
}

export function makePipeline(
  steps: readonly ProcessingStepSpec[],
  overrides: Partial<ProcessingPipelineSpec> = {},
): ProcessingPipeline {
  return unwrap(definePipeline(pipelineSpec(steps, overrides)));
}

/**
 * The canonical DIAMOND fixture: ingest → (left, right) → merge. Declared in a scrambled
 * order on purpose — determinism tests reorder it further.
 */
export function diamondSteps(): ProcessingStepSpec[] {
  return [
    step('merge', {
      dependsOn: ['left', 'right'],
      inputs: {
        a: { kind: 'step-output', stepId: 'left', output: 'out' },
        b: { kind: 'step-output', stepId: 'right', output: 'out' },
      },
      outputs: ['final'],
    }),
    step('right', {
      dependsOn: ['ingest'],
      inputs: { src: { kind: 'step-output', stepId: 'ingest', output: 'canonical' } },
      outputs: ['out'],
    }),
    step('ingest', {
      inputs: { raw: { kind: 'artifact', key: 'sha256:aa11' } },
      outputs: ['canonical'],
    }),
    step('left', {
      dependsOn: ['ingest'],
      inputs: { src: { kind: 'step-output', stepId: 'ingest', output: 'canonical' } },
      outputs: ['out'],
    }),
  ];
}
