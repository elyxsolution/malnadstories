import { describe, it, expect } from 'vitest';
import {
  hashDocument,
  serializeDocument,
  parseDocument,
  DOCUMENT_HASH_ALGORITHM,
  samplePageInputs,
} from '@workerv2/document';
import { assemble, unwrap } from './helpers.js';

describe('canonical hashing', () => {
  it('produces a sha256:<hex> identity', () => {
    const { document, hash } = assemble();
    expect(DOCUMENT_HASH_ALGORITHM).toBe('sha256');
    expect(hash).toBe(hashDocument(document));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('equivalent documents produce identical hashes; differing ones differ', () => {
    const a = assemble();
    const b = assemble();
    expect(a.hash).toBe(b.hash);

    const changedTitle = assemble({ metadata: { albumId: 'album-1', title: 'Different' } });
    expect(changedTitle.hash).not.toBe(a.hash);

    const changedPages = assemble({ pages: samplePageInputs(5) });
    expect(changedPages.hash).not.toBe(a.hash);

    const changedProfile = assemble({
      printProfile: {
        id: 'x',
        name: 'X',
        settings: { pageWidth: 100, pageHeight: 100, dpi: 150, colorSpace: 'cmyk', bleed: 0 },
      },
    });
    expect(changedProfile.hash).not.toBe(a.hash);
  });

  it('print metadata participates in identity', () => {
    const base = assemble({ printMetadata: { paper: 'silk' } });
    const other = assemble({ printMetadata: { paper: 'matte' } });
    expect(other.hash).not.toBe(base.hash);
  });
});

describe('serialization symmetry', () => {
  it('round-trips: serialize(parse(serialize(doc))) === serialize(doc)', () => {
    const { document, canonical } = assemble();
    const reparsed = unwrap(parseDocument(canonical));
    expect(serializeDocument(reparsed)).toBe(canonical);
    expect(hashDocument(reparsed)).toBe(hashDocument(document));
  });

  it('ignores incoming key order (canonical form is recomputed)', () => {
    const { canonical } = assemble();
    const o = JSON.parse(canonical) as Record<string, unknown>;
    // Re-emit the top-level keys in a deliberately non-canonical order.
    const reordered = JSON.stringify({
      pages: o['pages'],
      assembly: o['assembly'],
      printMetadata: o['printMetadata'],
      printProfile: o['printProfile'],
      metadata: o['metadata'],
      schemaVersion: o['schemaVersion'],
    });
    const fromReordered = unwrap(parseDocument(reordered));
    expect(serializeDocument(fromReordered)).toBe(canonical);
  });
});
