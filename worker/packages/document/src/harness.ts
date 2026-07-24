// DOCUMENT TEST HARNESS — reusable, dependency-free fixtures for exercising the Document Assembly
// Platform. Deterministic fake page-artifact keys (content-address shaped), a sample print profile,
// and a sample `DocumentSource` builder, so every test (and future consumer) gets consistent
// inputs without any real rendering, storage, or export. Ships in `src` (no test framework
// imported).

import type { DocumentPageInput, DocumentSource } from './build.js';
import type { PrintProfile } from './model.js';

/** A deterministic, content-address-shaped fake page-artifact key (`sha256:<hex>`). */
export function fakePageKey(seed: number): string {
  const hex = (seed >>> 0).toString(16).padStart(64, '0');
  return `sha256:${hex}`;
}

/** The default sample print profile (A-series-ish, 300dpi, sRGB). */
export const SAMPLE_PRINT_PROFILE: PrintProfile = {
  id: 'classic-a4-300',
  name: 'Classic A4 300dpi',
  settings: { pageWidth: 2480, pageHeight: 3508, dpi: 300, colorSpace: 'srgb', bleed: 36 },
};

/** `count` sequential page inputs (page 0 optionally a cover), each referencing a distinct key. */
export function samplePageInputs(count: number, withCover = false): DocumentPageInput[] {
  const pages: DocumentPageInput[] = [];
  for (let i = 0; i < count; i += 1) {
    pages.push({
      index: i,
      artifact: fakePageKey(i + 1),
      kind: withCover && i === 0 ? 'cover' : 'page',
      surfaceId: i === 0 && withCover ? 'cover' : `spread:${String(i).padStart(4, '0')}`,
    });
  }
  return pages;
}

/** A complete, valid sample `DocumentSource` (override any part). */
export function sampleDocumentSource(overrides: Partial<DocumentSource> = {}): DocumentSource {
  return {
    metadata: { albumId: 'album-1', title: 'A Sample Album' },
    printProfile: SAMPLE_PRINT_PROFILE,
    printMetadata: { paper: 'silk-170gsm', binding: 'layflat' },
    pages: samplePageInputs(4),
    ...overrides,
  };
}
