import { describe, it, expect } from 'vitest';
import {
  parsePreviewPdfKey,
  previewPdfKeyFor,
  lookupPreviewOwnership,
  reclaimPreviewPdfs,
  previewDryRunExecutor,
  previewExecutingExecutor,
  MIN_DESTRUCTIVE_AGE_MS,
  type VerifiedPreviewOrphan,
  type PreviewOwnershipQuery,
} from '../src/diagnostics/preview-pdf-cleanup/index.js';
import { previewPdfKey } from '../src/processors/pdf/pdf-contract.js';
import type { ListedObject } from '../src/diagnostics/orphan-scan/classify.js';
import type { ListPage, ListPageRequest } from '../src/diagnostics/orphan-scan/object-lister.js';

const U = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const A = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const KEY = previewPdfKeyFor(U, A);
const HOUR = 3600_000;
const NOW = Date.parse('2026-08-17T00:00:00.000Z');

function obj(key: string, ageHours: number, size = 1000, etag = 'e1'): ListedObject {
  return {
    key,
    sizeBytes: size,
    etag,
    lastModified: new Date(NOW - ageHours * HOUR).toISOString(),
  };
}

class FakeLister {
  constructor(private readonly objects: readonly ListedObject[]) {}
  async listPage(_r: ListPageRequest): Promise<ListPage> {
    return { objects: this.objects, nextToken: null };
  }
  async headObject(key: string): Promise<ListedObject | null> {
    return this.objects.find((o) => o.key === key) ?? null;
  }
}

/** Fake DB: `pdfRows` are keys named by album_pdfs.r2_key; `albums` are album ids that exist. */
function fakeDb(pdfRows: readonly string[], albums: readonly string[]): PreviewOwnershipQuery {
  return {
    async query<T>(text: string, params?: readonly unknown[]): Promise<readonly T[]> {
      const arg = (params?.[0] ?? []) as string[];
      if (text.includes('album_pdfs')) {
        return arg.filter((k) => pdfRows.includes(k)).map((k) => ({ r2_key: k })) as unknown as T[];
      }
      return arg.filter((id) => albums.includes(id)).map((id) => ({ id })) as unknown as T[];
    },
  };
}

describe('preview-PDF key parsing', () => {
  it('parses a valid preview key into userId + albumId', () => {
    const r = parsePreviewPdfKey(KEY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.userId).toBe(U);
      expect(r.value.albumId).toBe(A);
      expect(r.value.key).toBe(KEY);
    }
  });

  it('agrees exactly with the worker render contract', () => {
    expect(previewPdfKeyFor(U, A)).toBe(previewPdfKey(U, A));
  });

  it('refuses admin namespaces', () => {
    for (const k of ['stickers/x.jpg', 'cover-templates/x.jpg', 'album-products/x.jpg']) {
      const r = parsePreviewPdfKey(k);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection).toBe('admin-namespace');
    }
  });

  it('refuses raw uploads and derivatives (they are other object classes)', () => {
    for (const b of ['cccccccc-3333-4333-8333-cccccccccccc.jpg', 'x_full.jpg', 'x_thumb.jpg']) {
      const r = parsePreviewPdfKey(`${U}/albums/${A}/${b}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection).toBe('not-a-preview-pdf');
    }
  });

  it('refuses path traversal, wrong depth and non-UUID segments', () => {
    expect(parsePreviewPdfKey(`${U}/albums/${A}/../preview.pdf`).ok).toBe(false);
    expect(parsePreviewPdfKey(`${U}/albums/preview.pdf`).ok).toBe(false);
    expect(parsePreviewPdfKey(`not-a-uuid/albums/${A}/preview.pdf`).ok).toBe(false);
    expect(parsePreviewPdfKey(`${U}/albums/${A}/nested/preview.pdf`).ok).toBe(false);
  });

  it('is case-sensitive on the basename', () => {
    expect(parsePreviewPdfKey(`${U}/albums/${A}/Preview.PDF`).ok).toBe(false);
  });
});

describe('preview-PDF ownership', () => {
  it('OWNED when an album_pdfs row names the exact key', async () => {
    const r = await lookupPreviewOwnership(fakeDb([KEY], [A]), [{ key: KEY, albumId: A }]);
    expect(r.verdicts.get(KEY)).toEqual({ state: 'owned', via: 'album_pdfs.r2_key' });
  });

  it('ALBUM-EXISTS when no row names it but the album lives (the in-flight render case)', async () => {
    const r = await lookupPreviewOwnership(fakeDb([], [A]), [{ key: KEY, albumId: A }]);
    expect(r.verdicts.get(KEY)).toEqual({ state: 'album-exists' });
  });

  it('UNOWNED only when no row names it AND the album is gone', async () => {
    const r = await lookupPreviewOwnership(fakeDb([], []), [{ key: KEY, albumId: A }]);
    expect(r.verdicts.get(KEY)).toEqual({ state: 'unowned' });
  });

  it('propagates a database error rather than reporting "no owner"', async () => {
    const boom: PreviewOwnershipQuery = { async query() { throw new Error('db down'); } };
    await expect(lookupPreviewOwnership(boom, [{ key: KEY, albumId: A }])).rejects.toThrow('db down');
  });
});

describe('preview-PDF reclamation gates', () => {
  const run = (opts: {
    objects: readonly ListedObject[];
    pdfRows?: readonly string[];
    albums?: readonly string[];
    minAgeMs?: number;
    executor?: ReturnType<typeof previewDryRunExecutor>;
  }) => {
    const lister = new FakeLister(opts.objects);
    return reclaimPreviewPdfs({
      lister,
      reader: lister,
      db: fakeDb(opts.pdfRows ?? [], opts.albums ?? []),
      executor: opts.executor ?? previewDryRunExecutor(),
      minAgeMs: opts.minAgeMs,
      now: () => NOW,
    });
  };

  it('a live, owned preview PDF is never a candidate', async () => {
    const r = await run({ objects: [obj(KEY, 100)], pdfRows: [KEY], albums: [A] });
    expect(r.owned).toBe(1);
    expect(r.candidates).toBe(0);
  });

  it('an unowned PDF whose album still exists is PROTECTED (render may be in flight)', async () => {
    const r = await run({ objects: [obj(KEY, 100)], pdfRows: [], albums: [A] });
    expect(r.albumStillExists).toBe(1);
    expect(r.candidates).toBe(0);
  });

  it('an unowned, album-less, aged PDF IS a candidate', async () => {
    const r = await run({ objects: [obj(KEY, 100)] });
    expect(r.candidates).toBe(1);
    expect(r.verifiedCandidates).toBe(1);
  });

  it('the 24h grace period protects a recent orphan', async () => {
    const r = await run({ objects: [obj(KEY, 2)] });
    expect(r.recentUnconfirmed).toBe(1);
    expect(r.candidates).toBe(0);
  });

  it('future-dated objects are clock-skew protected', async () => {
    const r = await run({ objects: [obj(KEY, -48)] });
    expect(r.clockSkewProtected).toBe(1);
    expect(r.candidates).toBe(0);
  });

  it('non-preview objects are ignored entirely', async () => {
    const r = await run({
      objects: [obj('stickers/s.jpg', 100), obj(`${U}/albums/${A}/x_full.jpg`, 100)],
    });
    expect(r.previewPdfsSeen).toBe(0);
    expect(r.candidates).toBe(0);
  });

  it('DRY RUN plans but never deletes', async () => {
    const r = await run({ objects: [obj(KEY, 100)] });
    expect(r.mode).toBe('dry-run');
    expect(r.verifiedCandidates).toBe(1);
    expect(r.deleted).toBe(0);
    expect(r.deleteAttempted).toBe(0);
    expect(r.objects[0]?.action).toBe('PLANNED');
  });

  it('EXECUTE deletes exactly the verified key and verifies the deletion', async () => {
    const objects = [obj(KEY, 100)];
    const lister = new FakeLister(objects);
    const deleted: string[] = [];
    const store = new Map(objects.map((o) => [o.key, o]));
    const reader = {
      async headObject(key: string) { return store.get(key) ?? null; },
    };
    const r = await reclaimPreviewPdfs({
      lister,
      reader,
      db: fakeDb([], []),
      executor: previewExecutingExecutor({
        async deletePreviewVerified(o: VerifiedPreviewOrphan) {
          deleted.push(o.key);
          store.delete(o.key); // model real removal so post-delete verification is meaningful
        },
      }),
      now: () => NOW,
    });
    expect(deleted).toEqual([KEY]);
    expect(r.deleted).toBe(1);
    expect(r.deleteFailed).toBe(0);
    expect(r.deleteVerificationFailed).toBe(0);
    expect(r.bytesReclaimed).toBe(1000);
  });

  it('reports DELETE_VERIFICATION_FAILED when the object survives the delete', async () => {
    const objects = [obj(KEY, 100)];
    const lister = new FakeLister(objects);
    const r = await reclaimPreviewPdfs({
      lister,
      reader: lister, // never removes anything → object still readable afterwards
      db: fakeDb([], []),
      executor: previewExecutingExecutor({ async deletePreviewVerified() {} }),
      now: () => NOW,
    });
    expect(r.deleted).toBe(0);
    expect(r.deleteVerificationFailed).toBe(1);
  });

  it('EXECUTE aborts below the shared 24h destructive floor', async () => {
    const lister = new FakeLister([obj(KEY, 100)]);
    const r = await reclaimPreviewPdfs({
      lister,
      reader: lister,
      db: fakeDb([], []),
      executor: previewExecutingExecutor({ async deletePreviewVerified() { throw new Error('must not run'); } }),
      minAgeMs: HOUR,
      now: () => NOW,
    });
    expect(r.aborted).toBe(true);
    expect(r.deleted).toBe(0);
    expect(MIN_DESTRUCTIVE_AGE_MS).toBe(24 * HOUR);
  });

  it('a dry run may inspect below the floor (it deletes nothing)', async () => {
    const r = await run({ objects: [obj(KEY, 2)], minAgeMs: HOUR });
    expect(r.aborted).toBe(false);
    expect(r.candidates).toBe(1);
    expect(r.deleted).toBe(0);
  });

  it('an ownership failure marks the run incomplete and deletes nothing', async () => {
    const lister = new FakeLister([obj(KEY, 100)]);
    const r = await reclaimPreviewPdfs({
      lister,
      reader: lister,
      db: { async query() { throw new Error('db down'); } },
      executor: previewDryRunExecutor(),
      now: () => NOW,
    });
    expect(r.scanComplete).toBe(false);
    expect(r.undetermined).toBe(1);
    expect(r.candidates).toBe(0);
  });

  it('is idempotent: a second run over the emptied bucket finds nothing', async () => {
    const r = await run({ objects: [] });
    expect(r.candidates).toBe(0);
    expect(r.verifiedCandidates).toBe(0);
    expect(r.deleted).toBe(0);
  });
});

describe('the deletion boundary is a type, not a convention', () => {
  it('cannot delete an arbitrary key', () => {
    const deleter = { async deletePreviewVerified(_o: VerifiedPreviewOrphan) {} };
    // @ts-expect-error a string is not a VerifiedPreviewOrphan
    void (() => deleter.deletePreviewVerified(KEY));
    // @ts-expect-error a hand-built object cannot carry the unexported brand
    void (() => deleter.deletePreviewVerified({ key: KEY, userId: U, albumId: A }));
    expect(true).toBe(true);
  });
});
