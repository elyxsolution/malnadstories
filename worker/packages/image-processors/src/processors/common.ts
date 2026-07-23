// Shared processor plumbing: canonical, content-addressed descriptor production + typed descriptor
// reads with a schema check. Producing a descriptor as CANONICAL JSON is what makes each output
// content-addressable and deterministic — two logically-equal descriptors serialize byte-identically
// regardless of key order, so they collapse to the same artifact identity.

import type { StorageKey } from '@workerv2/infra-contracts';
import { canonicalJson } from '@workerv2/utils';
import { abortPermanent } from '@workerv2/processor-sdk';
import type { ProcessorContext } from '@workerv2/processor-sdk';

/** The input/output artifact slot names the foundation processors agree on. */
export const SLOT = {
  image: 'image',
  report: 'report',
  decoded: 'decoded',
  metadata: 'metadata',
  oriented: 'oriented',
  color: 'color',
  format: 'format',
} as const;

const JSON_META = { contentType: 'application/json', kind: 'derivative' } as const;

/**
 * Produce a descriptor as a canonical-JSON artifact and return its content address. Accepts the
 * concrete descriptor interfaces (which lack a JSON index signature) as `unknown` — they are
 * JSON-safe by construction and `canonicalJson` handles the serialization.
 */
export function produceDescriptor(ctx: ProcessorContext, descriptor: unknown): Promise<StorageKey> {
  return ctx.produceText(canonicalJson(descriptor), JSON_META);
}

/** Read a typed descriptor from a slot, asserting its `schema` tag (a `permanent` abort otherwise). */
export async function readDescriptor<T extends { schema: string }>(
  ctx: ProcessorContext,
  slot: string,
  schema: T['schema'],
): Promise<T> {
  const value = await ctx.readJson<T>(slot);
  if (value === null || typeof value !== 'object' || value.schema !== schema) {
    abortPermanent(`Input "${slot}" is not a ${schema} descriptor`, { slot, schema });
  }
  return value;
}
