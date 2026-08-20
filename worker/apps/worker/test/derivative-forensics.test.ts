import { describe, expect, it } from 'vitest';
import {
  buildDerivativeInventory,
  derivativeKeysForRaw,
  parseDerivativeKey,
  siblingKey,
} from '../src/diagnostics/derivative-forensics/index.js';
import { derivedKeys } from '../src/processors/image/keys.js';
import type { ListedObject } from '../src/diagnostics/orphan-scan/classify.js';
import type {
  ListPage,
  ListPageRequest,
  OwnershipQuery,
  ReadOnlyObjectLister,
} from '../src/diagnostics/orphan-scan/index.js';

/**
 * DERIVATIVE FORENSICS — read-only diagnostics.
 *
 * These tests assert two different things: that the parser is strict (a derivative can never be
 * confused with any other object class), and that the inventory's ownership model matches the
 * real lifecycle — including the legitimate mid-processing window where an object exists with no
 * column referencing it.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';
const U = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-08-17T12:00:00.000Z');

const raw = (id: string, ext = 'jpg') => `${USER}/albums/${ALBUM}/${id}.${ext}`;
const master = (id: string) => `${USER}/albums/${ALBUM}/${id}_full.jpg`;
const thumb = (id: string) => `${USER}/albums/${ALBUM}/${id}_thumb.jpg`;

const listed = (key: string, over: Partial<ListedObject> = {}): ListedObject => ({
  key,
  sizeBytes: 1024,
  lastModified: new Date(NOW - 3600000).toISOString(),
  etag: '"abc"',
  ...over,
});

// ── parser ───────────────────────────────────────────────────────────────────────────────

describe('parseDerivativeKey', () => {
  it('A — parses a valid master key', () => {
    const p = parseDerivativeKey(master(U(1)));
    expect(p).not.toBeNull();
    expect(p?.kind).toBe('master');
    expect(p?.userId).toBe(USER);
    expect(p?.albumId).toBe(ALBUM);
    expect(p?.uploadId).toBe(U(1));
    expect(p?.base).toBe(`${USER}/albums/${ALBUM}/${U(1)}`);
  });

  it('B — parses a valid thumbnail key', () => {
    const p = parseDerivativeKey(thumb(U(1)));
    expect(p?.kind).toBe('thumbnail');
    expect(p?.uploadId).toBe(U(1));
  });

  it('C/D — rejects malformed master and thumbnail keys', () => {
    for (const key of [
      `${USER}/albums/${ALBUM}/not-a-uuid_full.jpg`,
      `${USER}/albums/${ALBUM}/${U(1)}_full.png`, // codec always emits .jpg
      `${USER}/albums/${ALBUM}/${U(1)}_FULL.jpg`, // case-sensitive
      `${USER}/albums/${ALBUM}/${U(1)}_thumbnail.jpg`,
      `${USER}/albums/${ALBUM}/${U(1)}_full`, // no extension
      `${USER}/albums/${ALBUM}/sub/${U(1)}_full.jpg`, // wrong depth
      `${USER}/photos/${ALBUM}/${U(1)}_full.jpg`, // wrong separator
      `not-a-uuid/albums/${ALBUM}/${U(1)}_full.jpg`,
      `${USER}/albums/not-a-uuid/${U(1)}_full.jpg`,
      `${USER}/albums/${ALBUM}/../${U(1)}_full.jpg`,
      `/${USER}/albums/${ALBUM}/${U(1)}_full.jpg`,
      '',
    ]) {
      expect(parseDerivativeKey(key), key).toBeNull();
    }
  });

  it('E — rejects raw upload keys (every allowed extension)', () => {
    for (const ext of ['jpg', 'png', 'heic', 'webp']) {
      expect(parseDerivativeKey(raw(U(1), ext)), ext).toBeNull();
    }
  });

  it('F/G/H — rejects PDFs, cover, product, sticker and unrelated keys', () => {
    for (const key of [
      `${USER}/albums/${ALBUM}/preview.pdf`,
      `cover-templates/${U(1)}.png`,
      `cover-templates/${U(1)}_thumb.jpg`, // admin thumbs share a SUFFIX but not the namespace
      `album-products/${U(1)}.png`,
      `stickers/${U(1)}.png`,
      'random-object',
      'a/b/c/d/e',
    ]) {
      expect(parseDerivativeKey(key), key).toBeNull();
    }
  });

  it('J — a key that is neither strictly master nor thumbnail is never ambiguous, only null', () => {
    // There is no third derivative class, so ambiguity is impossible by construction.
    const p = parseDerivativeKey(`${USER}/albums/${ALBUM}/${U(1)}_full_thumb.jpg`);
    expect(p).toBeNull();
  });

  it('K — a master and its thumbnail share one base, and each names the other', () => {
    const m = parseDerivativeKey(master(U(1)))!;
    const t = parseDerivativeKey(thumb(U(1)))!;
    expect(m.base).toBe(t.base);
    expect(siblingKey(m)).toBe(thumb(U(1)));
    expect(siblingKey(t)).toBe(master(U(1)));
  });

  it('L — derivation is DETERMINISTIC and identical to the production processor', () => {
    for (const ext of ['jpg', 'png', 'heic', 'webp']) {
      const rawKey = raw(U(7), ext);
      const mine = derivativeKeysForRaw(rawKey);
      const theirs = derivedKeys(rawKey);
      // The forensic mirror must never drift from `processors/image/keys.ts`.
      expect(mine.master).toBe(theirs.sanitizedKey);
      expect(mine.thumbnail).toBe(theirs.thumbKey);
      // Deterministic: same input, same output, every time.
      expect(derivativeKeysForRaw(rawKey)).toEqual(mine);
      // …and every source extension collapses onto the SAME .jpg derivative pair.
      expect(mine.master).toBe(master(U(7)));
    }
  });

  it('records the raw-key candidates a derivative could descend from', () => {
    const p = parseDerivativeKey(master(U(1)))!;
    expect(p.rawKeyCandidates).toEqual([
      raw(U(1), 'jpg'),
      raw(U(1), 'png'),
      raw(U(1), 'heic'),
      raw(U(1), 'webp'),
    ]);
  });
});

// ── inventory ────────────────────────────────────────────────────────────────────────────

function fakeLister(pages: readonly (ListedObject[] | Error)[]): ReadOnlyObjectLister {
  let i = 0;
  return {
    async listPage(_r: ListPageRequest): Promise<ListPage> {
      const page = pages[i];
      i += 1;
      if (page instanceof Error) throw page;
      if (page === undefined) return { objects: [], nextToken: null };
      return { objects: page, nextToken: i < pages.length ? `t${i}` : null };
    },
  };
}

type Row = {
  sanitized_key: string | null;
  thumb_key: string | null;
  upload_key: string | null;
  r2_key: string | null;
  status: string;
};

function fakeDb(
  rows: readonly Row[],
  liveAlbums: readonly string[] = [ALBUM],
  fail = false,
): OwnershipQuery {
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<readonly T[]> {
      if (fail) throw new Error('connection reset');
      if (text.includes('from public.albums')) {
        const asked = (params[0] ?? []) as string[];
        return asked
          .filter((a) => liveAlbums.includes(a))
          .map((id) => ({ id })) as unknown as readonly T[];
      }
      return rows as unknown as readonly T[];
    },
  };
}

const readyRow = (id: string): Row => ({
  sanitized_key: master(id),
  thumb_key: thumb(id),
  upload_key: raw(id),
  r2_key: null,
  status: 'ready',
});

describe('buildDerivativeInventory', () => {
  it('classifies an owned pair as OWNED', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(1))), listed(thumb(U(1)))]]),
      db: fakeDb([readyRow(U(1))]),
      now: () => NOW,
    });
    expect(inv.scanComplete).toBe(true);
    expect(inv.masters).toBe(1);
    expect(inv.thumbnails).toBe(1);
    expect(inv.owned).toBe(2);
    expect(inv.noDbReference).toBe(0);
    expect(inv.records.every((r) => r.ownership === 'OWNED')).toBe(true);
  });

  it('protects the PersistStage→FinalizeStage window as RECONSTRUCTED_PENDING', async () => {
    // Objects exist; the row is still `pending` so its columns are null. Legitimate, not orphaned.
    const pendingRow: Row = {
      sanitized_key: null,
      thumb_key: null,
      upload_key: raw(U(2)),
      r2_key: raw(U(2)),
      status: 'pending',
    };
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(2))), listed(thumb(U(2)))]]),
      db: fakeDb([pendingRow]),
      now: () => NOW,
    });
    expect(inv.reconstructedPending).toBe(2);
    expect(inv.noDbReference).toBe(0);
  });

  it('reports an unreferenced pair without calling it deletable', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(3))), listed(thumb(U(3)))]]),
      db: fakeDb([], []), // no rows, album gone
      now: () => NOW,
    });
    expect(inv.noDbReference).toBe(2);
    expect(inv.unreferencedInDeletedAlbums).toBe(2);
    expect(inv.unreferencedInLiveAlbums).toBe(0);
    // The vocabulary deliberately contains no "deletable"/"orphan" verdict.
    expect(Object.keys(inv)).not.toContain('deletable');
  });

  it('separates unreferenced objects in LIVE albums from those in deleted albums', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(4))), listed(thumb(U(4)))]]),
      db: fakeDb([], [ALBUM]), // album still exists, but no row names the keys
      now: () => NOW,
    });
    expect(inv.unreferencedInLiveAlbums).toBe(2);
    expect(inv.unreferencedInDeletedAlbums).toBe(0);
  });

  it('detects an unpaired master and an unpaired thumbnail', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(5))), listed(thumb(U(6)))]]),
      db: fakeDb([]),
      now: () => NOW,
    });
    expect(inv.masterWithoutThumbnail).toEqual([`${USER}/albums/${ALBUM}/${U(5)}`]);
    expect(inv.thumbnailWithoutMaster).toEqual([`${USER}/albums/${ALBUM}/${U(6)}`]);
    expect(inv.records.every((r) => r.hasSibling === false)).toBe(true);
  });

  it('detects a DANGLING reference — a row naming a key absent from R2', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[]]),
      db: fakeDb([readyRow(U(9))]),
      now: () => NOW,
    });
    expect([...inv.danglingReferences].sort()).toEqual([master(U(9)), thumb(U(9))].sort());
  });

  it('ignores non-derivative objects entirely', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([
        [
          listed(raw(U(1))),
          listed(`${USER}/albums/${ALBUM}/preview.pdf`),
          listed(`stickers/${U(1)}.png`),
          listed(`cover-templates/${U(1)}_thumb.jpg`),
        ],
      ]),
      db: fakeDb([]),
      now: () => NOW,
    });
    expect(inv.nonDerivative).toBe(4);
    expect(inv.masters).toBe(0);
    expect(inv.thumbnails).toBe(0);
    expect(inv.records).toEqual([]);
  });

  it('processes every page and dedupes repeated listing entries', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(1))), listed(master(U(1)))], [listed(thumb(U(1)))]]),
      db: fakeDb([readyRow(U(1))]),
      now: () => NOW,
    });
    expect(inv.totalObjects).toBe(2);
    expect(inv.owned).toBe(2);
  });

  it('marks the inventory INCOMPLETE on a listing failure', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(1)))], new Error('R2 down')]),
      db: fakeDb([]),
      now: () => NOW,
    });
    expect(inv.scanComplete).toBe(false);
    expect(inv.errors[0]).toContain('R2 down');
  });

  it('marks the inventory INCOMPLETE on a database failure', async () => {
    const inv = await buildDerivativeInventory({
      lister: fakeLister([[listed(master(U(1)))]]),
      db: fakeDb([], [], true),
      now: () => NOW,
    });
    expect(inv.scanComplete).toBe(false);
    expect(inv.errors.some((e) => e.startsWith('db:'))).toBe(true);
  });

  it('exposes no deletion capability', async () => {
    const mod = (await import('../src/diagnostics/derivative-forensics/index.js')) as Record<
      string,
      unknown
    >;
    for (const forbidden of [
      'deleteDerivative',
      'cleanupDerivatives',
      'sweepDerivatives',
      'deleteObject',
      'R2Deleter',
    ]) {
      expect(mod[forbidden], forbidden).toBeUndefined();
    }
  });
});
