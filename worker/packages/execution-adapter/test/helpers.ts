import type { Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  FailureKind,
  Processor,
  ProcessingPipeline,
  ProcessorOutcome,
  RetryPolicy,
} from '@workerv2/processing';
import { definePipeline, stepFailure } from '@workerv2/processing';
import type { RunId, Timestamp, VersionSet } from '@workerv2/control-plane';
import { makeRunId, makeTimestamp, VersionSet as VS } from '@workerv2/control-plane';
import type { Coordinator } from '@workerv2/coordinator';
import { createCoordinator, coordinatorFromManifest } from '@workerv2/coordinator';
import type { CompiledManifest } from '@workerv2/manifest';
import {
  ASSEMBLE_ALBUM_PROCESSOR,
  ASSEMBLE_CAPABILITY,
  RENDER_CAPABILITY,
  RENDER_SURFACE_PROCESSOR,
  compileManifest,
} from '@workerv2/manifest';
import type { BlueprintSource } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';
import type { CapabilityOffer } from '@workerv2/runtime';
import { InMemoryProcessorRegistry } from '@workerv2/execution-adapter';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function unwrapErr<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error('unwrapErr() called on Ok');
  return r.error;
}

export const key = (s: string): StorageKey => s as unknown as StorageKey;

export function at(ms: number): Timestamp {
  return unwrap(makeTimestamp(new Date(Date.UTC(2026, 0, 1) + ms)));
}

export function runId(id = 'run-1'): RunId {
  return unwrap(makeRunId(id));
}

export function versions(): VersionSet {
  return unwrap(VS.create({ manifest: '1.0.0', pdfEngine: '1.0.0' }));
}

// --- Processors (INJECTED business; the adapter implements none) ---

/** A deterministic echo processor: fills every expected slot with `sha256:<stepId>-<slot>`. */
export function echoProcessor(name: string, version = '1.0.0'): Processor {
  return {
    descriptor: { name, version },
    process: (context): Promise<ProcessorOutcome> => {
      const outputs: Record<string, StorageKey> = {};
      for (const slot of context.expectedOutputs) {
        outputs[slot] = key(`sha256:${context.stepId}-${slot}`);
      }
      return Promise.resolve({ ok: true, value: { outputs } });
    },
  };
}

/** Fails `failuresBeforeSuccess` times (given kind), then echoes success. Mutable across attempts. */
export function flakyProcessor(
  name: string,
  failuresBeforeSuccess: number,
  kind: FailureKind = 'transient',
): Processor {
  let seen = 0;
  const echo = echoProcessor(name);
  return {
    descriptor: { name, version: '1.0.0' },
    process: (context): Promise<ProcessorOutcome> => {
      seen += 1;
      if (seen <= failuresBeforeSuccess) {
        return Promise.resolve({ ok: false, error: stepFailure(kind, `attempt ${seen} failed`) });
      }
      return echo.process(context);
    },
  };
}

/** Always returns the given failure kind. */
export function failingProcessor(name: string, kind: FailureKind = 'permanent'): Processor {
  return {
    descriptor: { name, version: '1.0.0' },
    process: (): Promise<ProcessorOutcome> =>
      Promise.resolve({ ok: false, error: stepFailure(kind, 'always fails') }),
  };
}

/**
 * One processor (shared name) whose behaviour is scripted PER node id: `'echo'` (default) or
 * fail the first N attempts of that node with a kind. Lets the diamond (all steps use `p`) vary
 * one node's behaviour without per-step processor names.
 */
export function scriptedProcessor(
  name: string,
  script: Record<string, 'echo' | { readonly fail: number; readonly kind?: FailureKind }>,
): Processor {
  const counts = new Map<string, number>();
  const echo = echoProcessor(name);
  return {
    descriptor: { name, version: '1.0.0' },
    process: (context): Promise<ProcessorOutcome> => {
      const rule = script[context.stepId] ?? 'echo';
      if (rule === 'echo') return echo.process(context);
      const n = (counts.get(context.stepId) ?? 0) + 1;
      counts.set(context.stepId, n);
      if (n <= rule.fail) {
        return Promise.resolve({
          ok: false,
          error: stepFailure(rule.kind ?? 'transient', `fail ${n}`),
        });
      }
      return echo.process(context);
    },
  };
}

/** Throws — exercises the dispatcher's throw-normalization. */
export function throwingProcessor(name: string): Processor {
  return {
    descriptor: { name, version: '1.0.0' },
    process: (): Promise<ProcessorOutcome> => {
      throw new Error('boom');
    },
  };
}

// --- Graphs ---

const rect = (x = 0, y = 0, w = 1, h = 1): { x: number; y: number; w: number; h: number } => ({
  x,
  y,
  w,
  h,
});

/** A diamond A → {B, C} → D; every step runs the processor named `p` and requires nothing. */
export function diamondPipeline(retryB?: RetryPolicy): ProcessingPipeline {
  return unwrap(
    definePipeline({
      id: 'diamond',
      version: '1.0.0',
      steps: [
        {
          id: 'a',
          processor: 'p',
          outputs: ['out'],
          inputs: { seed: { kind: 'artifact', key: 'sha256:seed' } },
        },
        {
          id: 'b',
          processor: 'p',
          dependsOn: ['a'],
          inputs: { in: { kind: 'step-output', stepId: 'a', output: 'out' } },
          outputs: ['out'],
          ...(retryB === undefined ? {} : { retry: retryB }),
        },
        {
          id: 'c',
          processor: 'p',
          dependsOn: ['a'],
          inputs: { in: { kind: 'step-output', stepId: 'a', output: 'out' } },
          outputs: ['out'],
        },
        {
          id: 'd',
          processor: 'p',
          dependsOn: ['b', 'c'],
          inputs: {
            b: { kind: 'step-output', stepId: 'b', output: 'out' },
            c: { kind: 'step-output', stepId: 'c', output: 'out' },
          },
          outputs: ['album'],
        },
      ],
    }),
  );
}

export function diamondCoordinator(retryB?: RetryPolicy): Coordinator {
  return createCoordinator({ pipeline: diamondPipeline(retryB), versions: versions() });
}

/** A registry with a single echo processor named `p` (satisfies the diamond). */
export function diamondRegistry(
  processorP: Processor = echoProcessor('p'),
): InMemoryProcessorRegistry {
  return new InMemoryProcessorRegistry().register(processorP);
}

export function sampleManifest(): CompiledManifest {
  const source: BlueprintSource = {
    albumId: 'alb-1',
    title: 'Goa 2026',
    cover: { placements: [{ slot: 'hero', artifact: 'sha256:c0ffee', frame: rect() }] },
    spreads: [
      { pages: 1, placements: [{ slot: 'main', artifact: 'sha256:aa11', frame: rect() }] },
      { pages: 2, placements: [{ slot: 'pano', artifact: 'sha256:dd44', frame: rect() }] },
    ],
  };
  const blueprint = unwrap(compileBlueprint(source)).blueprint;
  return unwrap(compileManifest(blueprint));
}

export function manifestCoordinator(): Coordinator {
  return unwrap(coordinatorFromManifest(sampleManifest(), versions()));
}

/** A registry + offers that satisfy the manifest's render/assemble processors + capabilities. */
export function manifestRegistry(): InMemoryProcessorRegistry {
  return new InMemoryProcessorRegistry()
    .register(echoProcessor(RENDER_SURFACE_PROCESSOR))
    .register(echoProcessor(ASSEMBLE_ALBUM_PROCESSOR));
}

export function manifestOffers(): readonly CapabilityOffer[] {
  return [
    { name: RENDER_CAPABILITY, version: '1.0.0' },
    { name: ASSEMBLE_CAPABILITY, version: '1.0.0' },
  ];
}
