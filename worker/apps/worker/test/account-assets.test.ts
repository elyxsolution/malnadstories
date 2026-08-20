import { describe, expect, it } from 'vitest';
import {
  collectAccountAssets,
  dedupeKeys,
  keysOfPhoto,
  type AssetQuery,
  type PhotoAssetRow,
} from '../src/diagnostics/account-assets/index.js';

/**
 * ACCOUNT ASSET PREFLIGHT — the enumeration matrix.
 *
 * Migration 0054 turned a silent profile cascade into a loud refusal. These tests pin the
 * enumeration an operator relies on afterwards: every photo lifecycle state, every asset class,
 * and the guarantee that the preflight issues nothing but reads.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';
const raw = (n: number) =>
  `${USER}/albums/${ALBUM}/${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
const master = (n: number) => raw(n).replace(/\.jpg$/, '_full.jpg');
const thumb = (n: number) => raw(n).replace(/\.jpg$/, '_thumb.jpg');
const pdfKey = `${USER}/albums/${ALBUM}/preview.pdf`;

/** Records every statement so the tests can prove the preflight only ever reads. */
function fakeDb(opts: {
  profile?: boolean;
  photos?: readonly PhotoAssetRow[];
  pdfs?: readonly string[];
  albums?: number;
}): AssetQuery & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query<T>(text: string): Promise<readonly T[]> {
      statements.push(text.trim().split(/\s+/)[0]!.toLowerCase());
      if (text.includes('from public.profiles')) {
        return (opts.profile === false ? [] : [{ id: USER }]) as unknown as readonly T[];
      }
      if (text.includes('from public.photos'))
        return (opts.photos ?? []) as unknown as readonly T[];
      if (text.includes('from public.album_pdfs')) {
        return (opts.pdfs ?? []).map((r2_key) => ({ r2_key })) as unknown as readonly T[];
      }
      if (text.includes('from public.albums')) {
        return [{ n: opts.albums ?? 0 }] as unknown as readonly T[];
      }
      return [] as unknown as readonly T[];
    },
  };
}

const photo = (over: Partial<PhotoAssetRow> = {}): PhotoAssetRow => ({
  id: 'p1',
  album_id: ALBUM,
  status: 'ready',
  r2_key: null,
  sanitized_key: null,
  thumb_key: null,
  ...over,
});

describe('keysOfPhoto — reads whatever exists, not what the status implies', () => {
  it('D — a PENDING photo normally holds only its raw key', () => {
    expect(keysOfPhoto(photo({ status: 'pending', r2_key: raw(1) }))).toEqual([raw(1)]);
  });

  it('E — a photo caught mid-processing can hold raw AND derivatives at once', () => {
    // PersistStage has written both objects; FinalizeStage has not yet cleared the raw key.
    const p = photo({
      status: 'pending',
      r2_key: raw(2),
      sanitized_key: master(2),
      thumb_key: thumb(2),
    });
    expect(keysOfPhoto(p)).toEqual([raw(2), master(2), thumb(2)]);
  });

  it('F/I — a READY photo holds its master and thumbnail, raw already cleared', () => {
    const p = photo({
      status: 'ready',
      r2_key: null,
      sanitized_key: master(3),
      thumb_key: thumb(3),
    });
    expect(keysOfPhoto(p)).toEqual([master(3), thumb(3)]);
  });

  it('G — a REJECTED photo keeps its raw object forever and has no derivatives', () => {
    expect(keysOfPhoto(photo({ status: 'rejected', r2_key: raw(4) }))).toEqual([raw(4)]);
  });

  it('H — a raw-only photo yields exactly one key', () => {
    expect(keysOfPhoto(photo({ r2_key: raw(5) }))).toHaveLength(1);
  });

  it('handles an already-purged photo with every key nulled', () => {
    expect(keysOfPhoto(photo())).toEqual([]);
  });

  it('K — duplicate keys are collapsed', () => {
    expect(dedupeKeys([raw(1), raw(1), master(1), raw(1)])).toEqual([raw(1), master(1)]);
  });
});

describe('collectAccountAssets', () => {
  it('A — a user with zero assets is not blocked', async () => {
    const a = await collectAccountAssets(fakeDb({}), USER);
    expect(a.deletionBlocked).toBe(false);
    expect(a.albums).toBe(0);
    expect(a.photos).toBe(0);
    expect(a.keys).toEqual([]);
    expect(a.guidance).toContain('strands nothing');
  });

  it('B — one album with one ready photo lists all three of its assets', async () => {
    const a = await collectAccountAssets(
      fakeDb({
        albums: 1,
        photos: [photo({ status: 'ready', sanitized_key: master(1), thumb_key: thumb(1) })],
      }),
      USER,
    );
    expect(a.deletionBlocked).toBe(true);
    expect(a.masterKeys).toBe(1);
    expect(a.thumbnailKeys).toBe(1);
    expect(a.rawKeys).toBe(0);
    expect(a.keys).toEqual([master(1), thumb(1)]);
    expect(a.guidance).toContain('BLOCKED');
  });

  it('C — many albums and many photos are all enumerated', async () => {
    const photos = Array.from({ length: 25 }, (_, i) =>
      photo({ id: `p${i}`, status: 'ready', sanitized_key: master(i), thumb_key: thumb(i) }),
    );
    const a = await collectAccountAssets(fakeDb({ albums: 4, photos }), USER);
    expect(a.albums).toBe(4);
    expect(a.photos).toBe(25);
    expect(a.keys).toHaveLength(50);
  });

  it('J — album preview PDFs are counted as owned assets', async () => {
    const a = await collectAccountAssets(fakeDb({ albums: 1, pdfs: [pdfKey] }), USER);
    expect(a.pdfKeys).toBe(1);
    expect(a.keys).toContain(pdfKey);
    expect(a.deletionBlocked).toBe(true); // an album exists even with no photos
  });

  it('reports the mix of photo lifecycle states', async () => {
    const a = await collectAccountAssets(
      fakeDb({
        albums: 1,
        photos: [
          photo({ id: '1', status: 'pending', r2_key: raw(1) }),
          photo({ id: '2', status: 'ready', sanitized_key: master(2), thumb_key: thumb(2) }),
          photo({ id: '3', status: 'rejected', r2_key: raw(3) }),
        ],
      }),
      USER,
    );
    expect(a.photosByStatus).toEqual({ pending: 1, ready: 1, rejected: 1 });
    expect(a.rawKeys).toBe(2);
    expect(a.masterKeys).toBe(1);
    expect(a.thumbnailKeys).toBe(1);
    expect(a.keys).toHaveLength(4);
  });

  it('K — the same key appearing on two rows is reported once', async () => {
    const a = await collectAccountAssets(
      fakeDb({
        albums: 1,
        photos: [photo({ id: '1', r2_key: raw(1) }), photo({ id: '2', r2_key: raw(1) })],
      }),
      USER,
    );
    expect(a.keys).toEqual([raw(1)]);
  });

  it('blocks on albums alone, even with no photos', async () => {
    const a = await collectAccountAssets(fakeDb({ albums: 2 }), USER);
    expect(a.deletionBlocked).toBe(true);
    expect(a.photos).toBe(0);
  });

  it('reports a missing profile without throwing', async () => {
    const a = await collectAccountAssets(fakeDb({ profile: false }), USER);
    expect(a.profileExists).toBe(false);
    expect(a.deletionBlocked).toBe(false);
    expect(a.guidance).toContain('No profile');
  });

  it('N — repeated preflights are identical and side-effect free', async () => {
    const db = fakeDb({ albums: 1, photos: [photo({ r2_key: raw(1) })] });
    const first = await collectAccountAssets(db, USER);
    const second = await collectAccountAssets(db, USER);
    expect(second).toEqual(first);
  });

  it('issues ONLY select statements — never a write', async () => {
    const db = fakeDb({ albums: 1, photos: [photo({ r2_key: raw(1) })], pdfs: [pdfKey] });
    await collectAccountAssets(db, USER);
    expect(db.statements).toEqual(['select', 'select', 'select', 'select']);
    expect(db.statements.every((s) => s === 'select')).toBe(true);
  });

  it('exposes no deletion or enqueue capability', async () => {
    const mod = (await import('../src/diagnostics/account-assets/index.js')) as Record<
      string,
      unknown
    >;
    for (const forbidden of [
      'deleteAccount',
      'deleteProfile',
      'purge',
      'enqueueCleanup',
      'enqueueR2Cleanup',
      'deleteObject',
    ]) {
      expect(mod[forbidden], forbidden).toBeUndefined();
    }
  });
});
