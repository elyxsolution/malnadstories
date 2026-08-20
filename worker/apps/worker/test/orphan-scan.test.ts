import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_ALLOWANCE_MS,
  ORPHAN_MIN_AGE_MS,
  PROTECTED_CLASSIFICATIONS,
  classifyObject,
  lookupOwnership,
  parseRawUploadKey,
  resolveScope,
  runOrphanScan,
  R2ReadOnlyLister,
  type ListPage,
  type ListPageRequest,
  type ListedObject,
  type OwnershipQuery,
  type ReadOnlyObjectLister,
  type ScanScope,
} from '../src/diagnostics/orphan-scan/index.js';

/**
 * READ-ONLY R2 ORPHAN DETECTION — the safety matrix.
 *
 * The property under test throughout is not "does it find orphans" but "can it ever call
 * something an orphan that isn't one". Every ambiguous input must land in a PROTECTED
 * classification, so most of these cases assert a negative.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';
const U1 = '33333333-3333-4333-8333-333333333333';
const U2 = '44444444-4444-4444-8444-444444444444';
/** Contains hex LETTERS, so `.toUpperCase()` genuinely changes it — needed for casing tests. */
const HEXY = 'abcdef01-abcd-4abc-8abc-abcdefabcdef';

const rawKey = (uuid: string, ext = 'jpg', user = USER, album = ALBUM) =>
  `${user}/albums/${album}/${uuid}.${ext}`;

const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();

const listed = (key: string, over: Partial<ListedObject> = {}): ListedObject => ({
  key,
  sizeBytes: 1024,
  lastModified: hoursAgo(48),
  etag: '"abc123"',
  ...over,
});

// ── key parser ───────────────────────────────────────────────────────────────────────────

describe('parseRawUploadKey — the raw-upload namespace contract', () => {
  it('accepts every extension the presign route can mint', () => {
    for (const ext of ['jpg', 'png', 'heic', 'webp']) {
      const r = parseRawUploadKey(rawKey(U1, ext));
      expect(r.ok, ext).toBe(true);
      if (r.ok) {
        expect(r.value.userId).toBe(USER);
        expect(r.value.albumId).toBe(ALBUM);
        expect(r.value.uploadId).toBe(U1);
        expect(r.value.extension).toBe(ext);
        // The key IS the upload identity — no separate mapping.
        expect(r.value.key).toBe(rawKey(U1, ext));
      }
    }
  });

  it('E — rejects every OTHER object class in the bucket', () => {
    const others = [
      `${USER}/albums/${ALBUM}/${U1}_full.jpg`, // sanitized master
      `${USER}/albums/${ALBUM}/${U1}_thumb.jpg`, // thumbnail
      `${USER}/albums/${ALBUM}/preview.pdf`, // album PDF
      `cover-templates/${U1}.png`,
      `album-products/${U1}.png`,
      `stickers/${U1}.png`,
    ];
    for (const key of others) {
      const r = parseRawUploadKey(key);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.rejection, key).not.toBe('malformed');
    }
  });

  it('D — rejects malformed keys inside the album namespace', () => {
    const malformed = [
      `${USER}/albums/${ALBUM}/not-a-uuid.jpg`,
      `${USER}/albums/${ALBUM}/${U1}.gif`, // extension not mintable
      `${USER}/albums/${ALBUM}/${U1}`, // no extension
      `${USER}/albums/${ALBUM}/${U1}.`, // trailing dot
      `${USER}/albums/${ALBUM}/.jpg`, // no stem
      `${USER}/albums/${ALBUM}/${HEXY.toUpperCase()}.jpg`, // non-canonical UUID casing
      `${USER}/albums/${ALBUM}/${U1}.JPG`, // presign only ever mints lowercase extensions
    ];
    for (const key of malformed) {
      const r = parseRawUploadKey(key);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.rejection, key).toBe('malformed');
    }
  });

  it('rejects wrong depth, wrong separator, traversal and absolute paths', () => {
    const bad = [
      `${USER}/albums/${ALBUM}/sub/${U1}.jpg`, // too deep
      `${USER}/${ALBUM}/${U1}.jpg`, // too shallow
      `${USER}/photos/${ALBUM}/${U1}.jpg`, // wrong separator segment
      `${USER}/albums/not-a-uuid/${U1}.jpg`,
      `not-a-uuid/albums/${ALBUM}/${U1}.jpg`,
      `${USER}/albums/${ALBUM}/../../${U1}.jpg`,
      `/${USER}/albums/${ALBUM}/${U1}.jpg`,
      `${USER}//albums/${ALBUM}/${U1}.jpg`,
      '',
    ];
    for (const key of bad) {
      const r = parseRawUploadKey(key);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.rejection, key).toBe('not-in-namespace');
    }
  });
});

// ── classification ───────────────────────────────────────────────────────────────────────

describe('classifyObject — the safety state machine', () => {
  const classify = (
    object: ListedObject,
    ownership: Parameters<typeof classifyObject>[0]['ownership'],
  ) => classifyObject({ object, ownership, now: NOW });

  it('A — valid raw key + matching photos row → OWNED', () => {
    const r = classify(listed(rawKey(U1)), { state: 'owned', via: 'upload_key', duplicateRows: 1 });
    expect(r.classification).toBe('OWNED');
    expect(r.uploadKey).toBe(rawKey(U1));
  });

  it('A2 — owned via the legacy r2_key column also counts as OWNED', () => {
    const r = classify(listed(rawKey(U1)), { state: 'owned', via: 'r2_key' });
    expect(r.classification).toBe('OWNED');
    expect(r.reason).toContain('r2_key');
  });

  it('B — unowned + 1 hour old → RECENT_UNCONFIRMED', () => {
    const r = classify(listed(rawKey(U1), { lastModified: hoursAgo(1) }), { state: 'unowned' });
    expect(r.classification).toBe('RECENT_UNCONFIRMED');
    expect(r.ageMs).toBe(3600000);
  });

  it('C — unowned + 25 hours old → ORPHAN_CANDIDATE', () => {
    const r = classify(listed(rawKey(U1), { lastModified: hoursAgo(25) }), { state: 'unowned' });
    expect(r.classification).toBe('ORPHAN_CANDIDATE');
    expect(r.reason).toContain('NOT proven safe to delete');
  });

  it('D — malformed key can never be a candidate, however old', () => {
    const r = classify(
      listed(`${USER}/albums/${ALBUM}/nope.jpg`, { lastModified: hoursAgo(9000) }),
      {
        state: 'unowned',
      },
    );
    expect(r.classification).toBe('MALFORMED_KEY');
    expect(PROTECTED_CLASSIFICATIONS).toContain(r.classification);
  });

  it('E — non-raw objects can never be candidates, however old', () => {
    for (const key of [
      `${USER}/albums/${ALBUM}/${U1}_full.jpg`,
      `${USER}/albums/${ALBUM}/${U1}_thumb.jpg`,
      `${USER}/albums/${ALBUM}/preview.pdf`,
      `stickers/${U1}.png`,
      `cover-templates/${U1}.png`,
      `album-products/${U1}.png`,
    ]) {
      const r = classify(listed(key, { lastModified: hoursAgo(9000) }), { state: 'unowned' });
      expect(r.classification, key).toBe('NOT_RAW_UPLOAD');
      expect(r.uploadKey, key).toBeNull();
    }
  });

  it('F — missing or unparseable LastModified → UNKNOWN_AGE', () => {
    for (const lastModified of [null, '', 'not-a-date']) {
      const r = classify(listed(rawKey(U1), { lastModified }), { state: 'unowned' });
      expect(r.classification, String(lastModified)).toBe('UNKNOWN_AGE');
      expect(r.ageMs).toBeNull();
    }
  });

  it('G — future LastModified beyond skew → CLOCK_SKEW_PROTECTED', () => {
    const future = new Date(NOW + CLOCK_SKEW_ALLOWANCE_MS + 60000).toISOString();
    const r = classify(listed(rawKey(U1), { lastModified: future }), { state: 'unowned' });
    expect(r.classification).toBe('CLOCK_SKEW_PROTECTED');
  });

  it('G2 — a small future skew inside the allowance is simply recent, not an orphan', () => {
    const slightlyAhead = new Date(NOW + 60000).toISOString();
    const r = classify(listed(rawKey(U1), { lastModified: slightlyAhead }), { state: 'unowned' });
    expect(r.classification).toBe('RECENT_UNCONFIRMED');
  });

  it('H — the 24h boundary is inclusive, deterministically', () => {
    const exactly = new Date(NOW - ORPHAN_MIN_AGE_MS).toISOString();
    const oneMsYounger = new Date(NOW - ORPHAN_MIN_AGE_MS + 1).toISOString();
    expect(
      classify(listed(rawKey(U1), { lastModified: exactly }), { state: 'unowned' }).classification,
    ).toBe('ORPHAN_CANDIDATE');
    expect(
      classify(listed(rawKey(U1), { lastModified: oneMsYounger }), { state: 'unowned' })
        .classification,
    ).toBe('RECENT_UNCONFIRMED');
  });

  it('an undetermined lookup protects the object', () => {
    const r = classify(listed(rawKey(U1), { lastModified: hoursAgo(9000) }), {
      state: 'undetermined',
      detail: 'connection reset',
    });
    expect(r.classification).toBe('UNDETERMINED');
    expect(PROTECTED_CLASSIFICATIONS).toContain(r.classification);
  });

  it('preserves diagnostic metadata without using it for ownership', () => {
    const r = classify(listed(rawKey(U1), { etag: '"deadbeef"', sizeBytes: 4242 }), {
      state: 'unowned',
    });
    expect(r.etag).toBe('"deadbeef"');
    expect(r.sizeBytes).toBe(4242);
  });
});

// ── scope validation ─────────────────────────────────────────────────────────────────────

describe('resolveScope — prefixes are built, never passed through', () => {
  it('builds album and user prefixes from validated UUIDs', () => {
    const album = resolveScope({ kind: 'album', userId: USER, albumId: ALBUM });
    expect(album.ok && album.scope.prefix).toBe(`${USER}/albums/${ALBUM}/`);
    const user = resolveScope({ kind: 'user', userId: USER });
    expect(user.ok && user.scope.prefix).toBe(`${USER}/albums/`);
    expect(album.ok && album.scope.bucketWide).toBe(false);
  });

  it('flags a whole-bucket scan explicitly', () => {
    const bucket = resolveScope({ kind: 'bucket' });
    expect(bucket.ok && bucket.scope.bucketWide).toBe(true);
    expect(bucket.ok && bucket.scope.prefix).toBe('');
  });

  it('rejects anything that is not a canonical UUID', () => {
    for (const bad of ['../..', '*', `${USER}/`, 'not-a-uuid', HEXY.toUpperCase(), '']) {
      expect(resolveScope({ kind: 'user', userId: bad }).ok, bad).toBe(false);
      expect(resolveScope({ kind: 'album', userId: bad, albumId: ALBUM }).ok, bad).toBe(false);
      expect(resolveScope({ kind: 'album', userId: USER, albumId: bad }).ok, bad).toBe(false);
    }
  });
});

// ── ownership lookup ─────────────────────────────────────────────────────────────────────

function fakeDb(
  rows: readonly { upload_key: string | null; r2_key: string | null }[],
): OwnershipQuery & {
  calls: number;
  batches: string[][];
} {
  const state = {
    calls: 0,
    batches: [] as string[][],
    async query<T>(_text: string, params: readonly unknown[] = []): Promise<readonly T[]> {
      state.calls += 1;
      const batch = (params[0] ?? []) as string[];
      state.batches.push(batch);
      const set = new Set(batch);
      return rows.filter(
        (r) =>
          (r.upload_key !== null && set.has(r.upload_key)) ||
          (r.r2_key !== null && set.has(r.r2_key)),
      ) as unknown as readonly T[];
    },
  };
  return state;
}

describe('lookupOwnership — batched, never N+1', () => {
  it('issues one query per batch, not one per key', async () => {
    const keys = Array.from({ length: 1200 }, (_, i) =>
      rawKey(`${U1.slice(0, 24)}${String(i).padStart(12, '0')}`),
    );
    const db = fakeDb([]);
    const result = await lookupOwnership(db, keys, 500);
    expect(db.calls).toBe(3); // 500 + 500 + 200
    expect(result.queries).toBe(3);
    expect(result.verdicts.size).toBe(1200);
  });

  it('dedupes keys before querying', async () => {
    const db = fakeDb([]);
    await lookupOwnership(db, [rawKey(U1), rawKey(U1), rawKey(U1)], 500);
    expect(db.batches[0]).toHaveLength(1);
  });

  it('resolves owned / unowned, preferring upload_key and falling back to legacy r2_key', async () => {
    const owned = rawKey(U1);
    const legacy = rawKey(U2);
    const db = fakeDb([
      { upload_key: owned, r2_key: owned },
      { upload_key: null, r2_key: legacy },
    ]);
    const { verdicts } = await lookupOwnership(db, [
      owned,
      legacy,
      rawKey('55555555-5555-4555-8555-555555555555'),
    ]);
    expect(verdicts.get(owned)).toMatchObject({ state: 'owned', via: 'upload_key' });
    expect(verdicts.get(legacy)).toMatchObject({ state: 'owned', via: 'r2_key' });
    expect(verdicts.get(rawKey('55555555-5555-4555-8555-555555555555'))).toMatchObject({
      state: 'unowned',
    });
  });

  it('J — reports duplicate upload_key rows rather than silently choosing one', async () => {
    const key = rawKey(U1);
    const db = fakeDb([
      { upload_key: key, r2_key: key },
      { upload_key: key, r2_key: null },
    ]);
    const { verdicts, inconsistencies } = await lookupOwnership(db, [key]);
    expect(inconsistencies).toEqual([
      { kind: 'duplicate-upload-key', uploadKey: key, rowCount: 2 },
    ]);
    // Still OWNED — the conservative outcome.
    expect(verdicts.get(key)).toMatchObject({ state: 'owned' });
  });

  it('does not query at all for an empty key set', async () => {
    const db = fakeDb([]);
    const result = await lookupOwnership(db, []);
    expect(db.calls).toBe(0);
    expect(result.queries).toBe(0);
  });
});

// ── full scan ────────────────────────────────────────────────────────────────────────────

function fakeLister(
  pages: readonly (ListedObject[] | Error)[],
): ReadOnlyObjectLister & { requests: ListPageRequest[] } {
  let index = 0;
  const requests: ListPageRequest[] = [];
  return {
    requests,
    async listPage(request: ListPageRequest): Promise<ListPage> {
      requests.push(request);
      const page = pages[index];
      index += 1;
      if (page instanceof Error) throw page;
      if (page === undefined) return { objects: [], nextToken: null };
      const more = index < pages.length;
      return { objects: page, nextToken: more ? `token-${index}` : null };
    },
  };
}

const SCOPE: ScanScope = { kind: 'album', prefix: `${USER}/albums/${ALBUM}/`, bucketWide: false };

describe('runOrphanScan', () => {
  it('K — processes every page of a paginated listing', async () => {
    const pages = [
      [listed(rawKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))],
      [listed(rawKey('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))],
      [listed(rawKey('cccccccc-cccc-4ccc-8ccc-cccccccccccc'))],
    ];
    const lister = fakeLister(pages);
    const report = await runOrphanScan({ lister, db: fakeDb([]), scope: SCOPE, now: () => NOW });
    expect(report.pagesListed).toBe(3);
    expect(report.scanned).toBe(3);
    expect(report.orphanCandidates).toBe(3);
    expect(report.scanComplete).toBe(true);
    expect(lister.requests[1]?.continuationToken).toBe('token-1');
    expect(lister.requests[0]?.prefix).toBe(SCOPE.prefix);
  });

  it('L — an empty prefix yields a clean, complete, zero-candidate report', async () => {
    const report = await runOrphanScan({
      lister: fakeLister([[]]),
      db: fakeDb([]),
      scope: SCOPE,
      now: () => NOW,
    });
    expect(report.scanComplete).toBe(true);
    expect(report.scanned).toBe(0);
    expect(report.candidates).toBe(0);
    expect(report.orphanCandidates).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it('M — a listing failure midway marks the scan INCOMPLETE', async () => {
    const report = await runOrphanScan({
      lister: fakeLister([[listed(rawKey(U1))], new Error('R2 connection reset')]),
      db: fakeDb([]),
      scope: SCOPE,
      now: () => NOW,
    });
    expect(report.scanComplete).toBe(false);
    expect(report.errors[0]?.stage).toBe('list');
    expect(report.errors[0]?.message).toContain('connection reset');
    // Whatever it did see is still classified — but the flag is what an operator must read.
    expect(report.scanned).toBe(1);
  });

  it('N — a DB lookup failure marks the scan INCOMPLETE and protects every candidate', async () => {
    const brokenDb: OwnershipQuery = {
      async query() {
        throw new Error('too many connections');
      },
    };
    const report = await runOrphanScan({
      lister: fakeLister([[listed(rawKey(U1), { lastModified: hoursAgo(9000) })]]),
      db: brokenDb,
      scope: SCOPE,
      now: () => NOW,
    });
    expect(report.scanComplete).toBe(false);
    expect(report.errors[0]?.stage).toBe('db-lookup');
    expect(report.orphanCandidates).toBe(0);
    expect(report.undetermined).toBe(1);
  });

  it('I — duplicate listing entries are deduped and reported deterministically', async () => {
    const key = rawKey(U1);
    const report = await runOrphanScan({
      lister: fakeLister([[listed(key), listed(key)], [listed(key)]]),
      db: fakeDb([]),
      scope: SCOPE,
      now: () => NOW,
    });
    expect(report.scanned).toBe(3);
    expect(report.duplicateListingEntries).toBe(2);
    expect(report.objects).toHaveLength(1);
  });

  it('classifies a realistic mixed namespace correctly', async () => {
    const ownedKey = rawKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const recentKey = rawKey('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const orphanKey = rawKey('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const report = await runOrphanScan({
      lister: fakeLister([
        [
          listed(ownedKey),
          listed(recentKey, { lastModified: hoursAgo(2) }),
          listed(orphanKey, { lastModified: hoursAgo(72) }),
          listed(`${USER}/albums/${ALBUM}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_full.jpg`),
          listed(`${USER}/albums/${ALBUM}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_thumb.jpg`),
          listed(`${USER}/albums/${ALBUM}/preview.pdf`),
          listed(`${USER}/albums/${ALBUM}/garbage.jpg`),
          listed(`stickers/${U1}.png`),
          listed(rawKey(U2), { lastModified: null }),
        ],
      ]),
      db: fakeDb([{ upload_key: ownedKey, r2_key: ownedKey }]),
      scope: SCOPE,
      now: () => NOW,
    });

    expect(report.scanComplete).toBe(true);
    expect(report.scanned).toBe(9);
    expect(report.notRawUpload).toBe(4); // _full, _thumb, preview.pdf, stickers/
    expect(report.candidates).toBe(5);
    expect(report.owned).toBe(1);
    expect(report.recentUnconfirmed).toBe(1);
    expect(report.orphanCandidates).toBe(1);
    expect(report.malformed).toBe(1);
    expect(report.unknownAge).toBe(1);
    // The §9 rollup: every parsed-but-unowned object, whatever its protection reason.
    expect(report.unknownKey).toBe(3);
    // Deterministic ordering.
    const keys = report.objects.map((o) => o.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('every object carries a human-readable reason', async () => {
    const report = await runOrphanScan({
      lister: fakeLister([
        [listed(rawKey(U1), { lastModified: hoursAgo(72) }), listed(`stickers/${U2}.png`)],
      ]),
      db: fakeDb([]),
      scope: SCOPE,
      now: () => NOW,
    });
    for (const o of report.objects) expect(o.reason.length).toBeGreaterThan(10);
  });

  it('records the scope verbatim, including the bucket-wide flag', async () => {
    const bucketScope: ScanScope = { kind: 'bucket', prefix: '', bucketWide: true };
    const lister = fakeLister([[]]);
    const report = await runOrphanScan({
      lister,
      db: fakeDb([]),
      scope: bucketScope,
      now: () => NOW,
    });
    expect(report.scope).toEqual(bucketScope);
    // An empty prefix must not be sent as a Prefix filter.
    expect(lister.requests[0]?.prefix).toBe('');
  });

  it('honours a configurable grace period', async () => {
    const key = rawKey(U1);
    const report = await runOrphanScan({
      lister: fakeLister([[listed(key, { lastModified: hoursAgo(2) })]]),
      db: fakeDb([]),
      scope: SCOPE,
      now: () => NOW,
      minAgeMs: 60 * 60 * 1000, // 1 hour
    });
    expect(report.minAgeHours).toBe(1);
    expect(report.orphanCandidates).toBe(1);
  });
});

// ── read-only lister ─────────────────────────────────────────────────────────────────────

describe('R2ReadOnlyLister — listing only', () => {
  it('maps ListObjectsV2 output and follows the continuation token', async () => {
    const sent: Record<string, unknown>[] = [];
    const client = {
      async send(command: unknown) {
        const input = (command as { input: Record<string, unknown> }).input;
        sent.push(input);
        return {
          Contents: [
            { Key: 'a', Size: 10, LastModified: new Date(NOW), ETag: '"e"' },
            { Key: 'b', Size: 20 }, // no LastModified, no ETag
            { Size: 30 }, // no Key — skipped
          ],
          IsTruncated: true,
          NextContinuationToken: 'next-1',
        };
      },
    };
    const lister = new R2ReadOnlyLister(client, 'bucket');
    const page = await lister.listPage({ prefix: 'p/', continuationToken: null, maxKeys: 1000 });

    expect(page.objects).toHaveLength(2);
    expect(page.objects[0]).toMatchObject({ key: 'a', sizeBytes: 10, etag: '"e"' });
    expect(page.objects[1]).toMatchObject({ key: 'b', lastModified: null, etag: null });
    expect(page.nextToken).toBe('next-1');
    expect(sent[0]).toMatchObject({ Bucket: 'bucket', Prefix: 'p/', MaxKeys: 1000 });
    expect(sent[0]).not.toHaveProperty('ContinuationToken');
  });

  it('ends the listing when truncated but no token is supplied', async () => {
    const client = {
      async send() {
        return { Contents: [], IsTruncated: true };
      },
    };
    const page = await new R2ReadOnlyLister(client, 'b').listPage({
      prefix: '',
      continuationToken: null,
      maxKeys: 10,
    });
    expect(page.nextToken).toBeNull();
  });

  it('omits Prefix entirely for a bucket-wide scan', async () => {
    const sent: Record<string, unknown>[] = [];
    const client = {
      async send(command: unknown) {
        sent.push((command as { input: Record<string, unknown> }).input);
        return { Contents: [], IsTruncated: false };
      },
    };
    await new R2ReadOnlyLister(client, 'b').listPage({
      prefix: '',
      continuationToken: null,
      maxKeys: 5,
    });
    expect(sent[0]).not.toHaveProperty('Prefix');
  });

  it('exposes no write or delete capability', () => {
    const lister = new R2ReadOnlyLister(
      {
        async send() {
          return {};
        },
      },
      'b',
    ) as unknown as Record<string, unknown>;
    for (const forbidden of ['delete', 'remove', 'write', 'put', 'deleteObject', 'deleteObjects']) {
      expect(lister[forbidden], forbidden).toBeUndefined();
    }
  });
});
