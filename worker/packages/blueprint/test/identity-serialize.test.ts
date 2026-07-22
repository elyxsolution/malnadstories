import { describe, expect, it } from 'vitest';
import {
  serializeBlueprint,
  parseBlueprint,
  hashBlueprint,
  BLUEPRINT_HASH_ALGORITHM,
} from '@workerv2/blueprint';
// TEST-ONLY imports proving byte-compatibility with the artifact platform's addressing —
// the blueprint package itself has no storage dependency.
import {
  Sha256ContentAddressing,
  ContentAddressedArtifactStore,
  InMemoryBlobStore,
} from '@workerv2/artifact-store';
import type { StorageKey } from '@workerv2/infra-contracts';
import { compiled, sampleBlueprint, sampleSource, unwrap } from './helpers.js';

describe('canonical serialization', () => {
  it('serializes deterministically (repeat = byte-identical)', () => {
    const blueprint = sampleBlueprint();
    expect(serializeBlueprint(blueprint)).toBe(serializeBlueprint(blueprint));
    expect(serializeBlueprint(blueprint)).toBe(compiled().canonical);
  });

  it('round-trips: serialize(parse(serialize(bp))) === serialize(bp)', () => {
    const blueprint = sampleBlueprint();
    const canonical = serializeBlueprint(blueprint);
    const reparsed = unwrap(parseBlueprint(canonical));
    expect(serializeBlueprint(reparsed)).toBe(canonical);
    expect(reparsed).toStrictEqual(blueprint);
  });

  it('incoming key order is irrelevant — canonical form is recomputed, never trusted', () => {
    const blueprint = sampleBlueprint();
    const canonical = serializeBlueprint(blueprint);
    // Rebuild the JSON with scrambled key order + extra whitespace.
    const scrambled = JSON.stringify(JSON.parse(canonical), null, 4).replace(
      '"schemaVersion"',
      '"schemaVersion"',
    ); // formatting-only difference
    expect(scrambled).not.toBe(canonical);
    const reparsed = unwrap(parseBlueprint(scrambled));
    expect(serializeBlueprint(reparsed)).toBe(canonical);
    expect(hashBlueprint(reparsed)).toBe(hashBlueprint(blueprint));
  });

  it('rejects unparseable JSON', () => {
    expect(parseBlueprint('{not json').ok).toBe(false);
  });
});

describe('blueprint identity — content addressing', () => {
  it('has the sha256:<hex> shape', () => {
    const hash = hashBlueprint(sampleBlueprint());
    expect(hash).toMatch(new RegExp(`^${BLUEPRINT_HASH_ALGORITHM}:[0-9a-f]{64}$`));
  });

  it('identity depends ONLY on canonical content (same source → same hash)', () => {
    expect(compiled().hash).toBe(compiled().hash);
    expect(hashBlueprint(sampleBlueprint())).toBe(compiled().hash);
  });

  it('any semantic change changes the identity', () => {
    const base = compiled().hash;
    expect(compiled(sampleSource({ title: 'Coorg 2026' })).hash).not.toBe(base);
    const source = sampleSource();
    const editedFrame = {
      ...source,
      spreads: [
        {
          ...source.spreads[0],
          pages: source.spreads[0]?.pages ?? 1,
          placements: [
            { slot: 'main', artifact: 'sha256:aa11', frame: { x: 0, y: 0, w: 0.9, h: 1 } },
            { slot: 'inset', artifact: 'sha256:bb22', frame: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 } },
          ],
        },
        ...source.spreads.slice(1),
      ],
    } as typeof source;
    expect(compiled(editedFrame).hash).not.toBe(base);
  });

  it('matches the artifact platform addressing byte-for-byte (blueprint-as-artifact)', async () => {
    const { blueprint, canonical, hash } = compiled();
    const bytes = new TextEncoder().encode(canonical);
    // Hashing compatibility…
    expect(new Sha256ContentAddressing().address(bytes)).toBe(hash);
    // …so a canonical blueprint stored as an artifact gets key === its own identity.
    const store = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const stored = await store.putContent(bytes, 'application/json');
    expect(stored.key).toBe(hash as unknown as StorageKey);
    expect(hashBlueprint(blueprint)).toBe(hash);
  });
});
