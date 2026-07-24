import { describe, it, expect } from 'vitest';
import {
  buildDocument,
  sampleDocumentSource,
  samplePageInputs,
  fakePageKey,
} from '@workerv2/document';

/** Build and expect a failure whose message matches. */
function expectFail(overrides: Parameters<typeof sampleDocumentSource>[0], match: RegExp): void {
  const result = buildDocument(sampleDocumentSource(overrides));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.message).toMatch(match);
}

describe('validation failures — an invalid document never exists', () => {
  it('rejects incomplete metadata (missing album id / title)', () => {
    expectFail({ metadata: { albumId: '', title: 'x' } }, /albumId/);
    expectFail({ metadata: { albumId: 'album-1', title: '  ' } }, /title/);
  });

  it('rejects an empty page set', () => {
    expectFail({ pages: [] }, /at least one page/);
  });

  it('rejects a missing / malformed page artifact reference', () => {
    expectFail({ pages: [{ index: 0, artifact: 'not-a-key' }] }, /content-addressed key/);
    expectFail({ pages: [{ index: 0, artifact: '' }] }, /content-addressed key/);
  });

  it('rejects duplicate page indices', () => {
    expectFail(
      {
        pages: [
          { index: 0, artifact: fakePageKey(1) },
          { index: 0, artifact: fakePageKey(2) },
        ],
      },
      /duplicate page index/,
    );
  });

  it('rejects non-contiguous page indices', () => {
    expectFail(
      {
        pages: [
          { index: 0, artifact: fakePageKey(1) },
          { index: 2, artifact: fakePageKey(2) },
        ],
      },
      /contiguous/,
    );
  });

  it('rejects inconsistent print settings', () => {
    expectFail(
      {
        printProfile: {
          id: 'p',
          name: 'P',
          settings: { pageWidth: 0, pageHeight: 100, dpi: 300, colorSpace: 'srgb', bleed: 0 },
        },
      },
      /pageWidth\/pageHeight/,
    );
    expectFail(
      {
        printProfile: {
          id: 'p',
          name: 'P',
          settings: { pageWidth: 100, pageHeight: 100, dpi: -1, colorSpace: 'srgb', bleed: 0 },
        },
      },
      /dpi/,
    );
    expectFail(
      {
        printProfile: {
          id: 'p',
          name: 'P',
          settings: {
            pageWidth: 100,
            pageHeight: 100,
            dpi: 300,
            colorSpace: 'neon' as never,
            bleed: 0,
          },
        },
      },
      /colorSpace/,
    );
  });

  it('rejects an inconsistent cover (includeCover mismatch / cover not first)', () => {
    // A cover page present but includeCover forced false.
    expectFail(
      { pages: samplePageInputs(3, true), assembly: { includeCover: false } },
      /includeCover is inconsistent/,
    );
    // A cover that is not page 0.
    expectFail(
      {
        pages: [
          { index: 0, artifact: fakePageKey(1), kind: 'page' },
          { index: 1, artifact: fakePageKey(2), kind: 'cover' },
        ],
      },
      /cover, when present, must be page 0/,
    );
  });

  it('rejects more than one cover', () => {
    expectFail(
      {
        pages: [
          { index: 0, artifact: fakePageKey(1), kind: 'cover' },
          { index: 1, artifact: fakePageKey(2), kind: 'cover' },
        ],
      },
      /at most one cover/,
    );
  });
});
