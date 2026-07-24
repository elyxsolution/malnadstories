import { describe, it, expect } from 'vitest';
import {
  buildDocument,
  toDocumentManifest,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_MANIFEST_SCHEMA,
  sampleDocumentSource,
  samplePageInputs,
  fakePageKey,
} from '@workerv2/document';
import { assemble, unwrap } from './helpers.js';

describe('buildDocument — construction', () => {
  it('assembles a valid document with derived page count + defaults', () => {
    const { document } = assemble();
    expect(document.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
    expect(document.metadata).toMatchObject({
      albumId: 'album-1',
      title: 'A Sample Album',
      pageCount: 4,
    });
    expect(document.pages).toHaveLength(4);
    expect(document.assembly).toEqual({
      ordering: 'sequential',
      duplex: false,
      includeCover: false,
    });
    expect(document.printProfile.settings.dpi).toBe(300);
    expect(document.printMetadata).toEqual({ paper: 'silk-170gsm', binding: 'layflat' });
  });

  it('derives includeCover from a cover page and puts the cover first', () => {
    const { document } = assemble({ pages: samplePageInputs(3, true) });
    expect(document.assembly.includeCover).toBe(true);
    expect(document.pages[0]).toMatchObject({ index: 0, kind: 'cover' });
  });

  it('produces a canonical form + sha256 hash', () => {
    const { hash, canonical } = assemble();
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(canonical).toContain('"schemaVersion":"1.0.0"');
  });
});

describe('page ordering', () => {
  it('sorts pages by index into canonical order regardless of input order', () => {
    const pages = [
      { index: 2, artifact: fakePageKey(3) },
      { index: 0, artifact: fakePageKey(1) },
      { index: 1, artifact: fakePageKey(2) },
    ];
    const { document } = unwrapBuild({ pages });
    expect(document.pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(document.pages[0]?.artifact).toBe(fakePageKey(1));
  });

  it('input order does not affect identity (order-independent hash)', () => {
    const forward = assemble({ pages: samplePageInputs(4) });
    const reversed = assemble({ pages: [...samplePageInputs(4)].reverse() });
    expect(reversed.hash).toBe(forward.hash);
  });
});

describe('document manifest', () => {
  it('projects the ordered page references', () => {
    const { document } = assemble();
    const manifest = toDocumentManifest(document);
    expect(manifest).toMatchObject({
      schema: DOCUMENT_MANIFEST_SCHEMA,
      albumId: 'album-1',
      pageCount: 4,
    });
    expect(manifest.pages.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(manifest.pages[0]).toMatchObject({ artifact: fakePageKey(1), kind: 'page' });
  });
});

function unwrapBuild(
  overrides: Parameters<typeof sampleDocumentSource>[0],
): ReturnType<typeof assemble> {
  return unwrap(buildDocument(sampleDocumentSource(overrides)));
}
