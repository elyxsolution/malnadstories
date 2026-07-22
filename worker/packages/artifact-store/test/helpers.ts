import type { Result } from '@workerv2/contracts';
import { makeAssetId, makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { ArtifactProvenance } from '@workerv2/infra-contracts';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

/** Deterministic provenance fixture — time is injected, never read from the clock. */
export function provenance(overrides: Partial<ArtifactProvenance> = {}): ArtifactProvenance {
  return {
    runId: unwrap(makeRunId('run-1')),
    step: 'canonicalize',
    kind: 'canonical',
    versions: { workerRuntime: '1.0.0', imageEngine: '1.0.0' },
    sourceAssetIds: [unwrap(makeAssetId('ast-1'))],
    createdAt: unwrap(makeTimestamp('2026-07-23T00:00:00Z')),
    ...overrides,
  };
}

/** Turn fixed chunks into an `AsyncIterable` byte stream. */
export async function* streamOf(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}
