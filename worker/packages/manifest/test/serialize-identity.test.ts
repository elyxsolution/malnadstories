import { describe, expect, it } from 'vitest';
import {
  hashManifest,
  parseManifest,
  serializeManifest,
  validateManifest,
  MANIFEST_HASH_ALGORITHM,
} from '@workerv2/manifest';
import { compiled, mutableClone, sampleManifest, unwrap, unwrapErr } from './helpers.js';

describe('canonical serialization', () => {
  it('round-trips byte-stably through parse', () => {
    const manifest = sampleManifest();
    const canonical = serializeManifest(manifest);
    const reparsed = unwrap(parseManifest(canonical));
    expect(serializeManifest(reparsed)).toBe(canonical);
  });

  it('is independent of incoming key order and whitespace', () => {
    const manifest = sampleManifest();
    const canonical = serializeManifest(manifest);
    // Pretty-print + JS object round-trip scrambles nothing semantically.
    const scrambled = JSON.stringify(JSON.parse(canonical), null, 2);
    expect(serializeManifest(unwrap(parseManifest(scrambled)))).toBe(canonical);
  });

  it('drops unknown keys at the gate — they can never reach the identity', () => {
    const manifest = sampleManifest();
    const raw = mutableClone(manifest);
    raw.futureField = 'ignored';
    const nodes = raw.nodes as Record<string, unknown>[];
    const first = nodes[0];
    if (first !== undefined) first.executionHint = 'fast';
    const revalidated = unwrap(validateManifest(raw));
    expect(serializeManifest(revalidated)).toBe(serializeManifest(manifest));
    expect(hashManifest(revalidated)).toBe(hashManifest(manifest));
  });

  it('rejects unparseable JSON', () => {
    expect(unwrapErr(parseManifest('{nope')).message).toContain('parseable');
  });
});

describe('identity (content addressing)', () => {
  it('hashes to sha256:<hex> — the shared content-address format', () => {
    expect(MANIFEST_HASH_ALGORITHM).toBe('sha256');
    expect(compiled().hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('identity depends only on canonical content', () => {
    const a = sampleManifest();
    const b = sampleManifest();
    expect(hashManifest(a)).toBe(hashManifest(b));
    const reparsed = unwrap(
      parseManifest(JSON.stringify(JSON.parse(serializeManifest(a)), null, 2)),
    );
    expect(hashManifest(reparsed)).toBe(hashManifest(a));
  });

  it('every semantic change alters the hash', () => {
    const base = hashManifest(sampleManifest());
    // Different blueprint content → different derived work → different identity.
    expect(hashManifest(sampleManifest({ title: 'Coorg 2026' }))).not.toBe(base);
    expect(hashManifest(sampleManifest({ cover: undefined }))).not.toBe(base);

    // Direct config change on a revalidated clone.
    const raw = mutableClone(sampleManifest());
    const nodes = raw.nodes as Record<string, unknown>[];
    const first = nodes[0];
    if (first !== undefined) first.config = { surfaces: ['cover'] };
    expect(hashManifest(unwrap(validateManifest(raw)))).not.toBe(base);
  });

  it('the compiled wrapper hash matches hashManifest of its manifest', () => {
    const result = compiled();
    expect(result.hash).toBe(hashManifest(result.manifest));
    expect(result.canonical).toBe(serializeManifest(result.manifest));
  });
});
