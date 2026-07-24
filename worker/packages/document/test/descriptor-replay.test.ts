import { describe, it, expect } from 'vitest';
import {
  describeDocument,
  buildDocument,
  parseDocument,
  hashDocument,
  serializeDocument,
  toDocumentManifest,
  DOCUMENT_DESCRIPTOR_SCHEMA,
  sampleDocumentSource,
  samplePageInputs,
} from '@workerv2/document';
import { assemble, unwrap } from './helpers.js';

describe('descriptor generation', () => {
  it('records identity, ordered page references, profile, metadata, and assembly config', () => {
    const assembled = assemble({ pages: samplePageInputs(3, true) });
    const descriptor = describeDocument(assembled);
    expect(descriptor).toMatchObject({
      schema: DOCUMENT_DESCRIPTOR_SCHEMA,
      hash: assembled.hash,
      schemaVersion: '1.0.0',
      metadata: { albumId: 'album-1', pageCount: 3 },
      assembly: { ordering: 'sequential', includeCover: true },
    });
    expect(descriptor.printProfile.id).toBe('classic-a4-300');
    expect(descriptor.pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(descriptor.pages[0]).toMatchObject({ kind: 'cover' });
  });

  it('is a pure function of the document (equivalent documents → identical descriptors)', () => {
    const a = describeDocument(assemble());
    const b = describeDocument(assemble());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('deterministic identity + replay consistency', () => {
  it('builds byte-identically across independent runs (no timestamps/randomness)', () => {
    const source = sampleDocumentSource();
    const a = unwrap(buildDocument(source));
    const b = unwrap(buildDocument(source));
    expect(a.canonical).toBe(b.canonical);
    expect(a.hash).toBe(b.hash);
  });

  it('replays from the canonical form to the same identity + descriptor', () => {
    const original = assemble({ pages: samplePageInputs(5) });
    const replayed = unwrap(parseDocument(original.canonical));
    expect(hashDocument(replayed)).toBe(original.hash);
    expect(serializeDocument(replayed)).toBe(original.canonical);
    const rebuilt = {
      document: replayed,
      hash: hashDocument(replayed),
      canonical: original.canonical,
    };
    expect(JSON.stringify(describeDocument(rebuilt))).toBe(
      JSON.stringify(describeDocument(original)),
    );
    expect(JSON.stringify(toDocumentManifest(replayed))).toBe(
      JSON.stringify(toDocumentManifest(original.document)),
    );
  });
});

describe('immutable behavior', () => {
  it('deep-freezes the document, pages, and derived artifacts', () => {
    const { document } = assemble();
    const descriptor = describeDocument(assemble());
    const manifest = toDocumentManifest(document);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.pages)).toBe(true);
    expect(Object.isFrozen(document.pages[0])).toBe(true);
    expect(Object.isFrozen(document.printProfile.settings)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('a frozen page cannot be mutated', () => {
    const { document } = assemble();
    expect(() => {
      (document.pages[0] as { index: number }).index = 99;
    }).toThrow();
  });
});
