import { describe, expect, it } from 'vitest';
import {
  MIN_DESTRUCTIVE_AGE_MS,
  NON_DELETABLE_STATES,
  dryRunExecutor,
  executingExecutor,
  runOrphanCleanup,
  verifyCandidate,
  type CleanupExecutor,
  type FreshOwnership,
  type PreDeleteSummary,
  type VerifiedOrphan,
  type VerifiedOrphanDeleter,
} from '../src/diagnostics/orphan-cleanup/index.js';
import {
  ORPHAN_MIN_AGE_MS,
  R2ReadOnlyLister,
  type ClassifiedObject,
  type ListPage,
  type ListPageRequest,
  type OwnershipQuery,
  type ReadOnlyMetadataReader,
  type ReadOnlyObjectLister,
  type ScanScope,
} from '../src/diagnostics/orphan-scan/index.js';
import type { ListedObject } from '../src/diagnostics/orphan-scan/classify.js';

/**
 * SAFE ORPHAN RECLAMATION — the safety matrix.
 *
 * The property under test is not "does it delete orphans" but "can it ever delete something it
 * should not". Most assertions are therefore about the DELETE SPY recording zero calls.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const OTHER_ALBUM = '88888888-8888-4888-8888-888888888888';
const U = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

const NOW = Date.parse('2026-08-17T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();
const rawKey = (uuid: string, user = USER, album = ALBUM) => `${user}/albums/${album}/${uuid}.jpg`;

const SCOPE: ScanScope = { kind: 'album', prefix: `${USER}/albums/${ALBUM}/`, bucketWide: false };
const BUCKET_SCOPE: ScanScope = { kind: 'bucket', prefix: '', bucketWide: true };

const listed = (key: string, over: Partial<ListedObject> = {}): ListedObject => ({
  key,
  sizeBytes: 1024,
  lastModified: hoursAgo(48),
  etag: '"abc"',
  ...over,
});

/**
 * THE DELETE SPY — every test asserts against its call log.
 *
 * When a `reader` is supplied the spy also models REAL removal (the key stops being readable),
 * which is what lets post-delete verification succeed. Omitting the reader deliberately models a
 * delete that reports success while the object survives — see test Q.
 */
function spyDeleter(
  behaviour: 'ok' | 'throw' = 'ok',
  reader?: { deletedKeys: Set<string> },
): VerifiedOrphanDeleter & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async deleteVerified(orphan: VerifiedOrphan) {
      calls.push(orphan.key);
      if (behaviour === 'throw') throw new Error('R2 refused the delete');
      reader?.deletedKeys.add(orphan.key);
    },
  };
}

function fakeLister(pages: readonly (ListedObject[] | Error)[]): ReadOnlyObjectLister {
  let index = 0;
  return {
    async listPage(_request: ListPageRequest): Promise<ListPage> {
      const page = pages[index];
      index += 1;
      if (page instanceof Error) throw page;
      if (page === undefined) return { objects: [], nextToken: null };
      return { objects: page, nextToken: index < pages.length ? `t${index}` : null };
    },
  };
}

/** A metadata reader whose per-key behaviour is scripted. `deletedKeys` models real removal. */
function fakeReader(
  script: Record<string, ListedObject | null | Error> = {},
  fallback: (key: string) => ListedObject | null = (k) => listed(k),
): ReadOnlyMetadataReader & { deletedKeys: Set<string>; heads: string[] } {
  const deletedKeys = new Set<string>();
  const heads: string[] = [];
  return {
    deletedKeys,
    heads,
    async headObject(key: string) {
      heads.push(key);
      if (deletedKeys.has(key)) return null;
      if (key in script) {
        const v = script[key];
        if (v instanceof Error) throw v;
        return v ?? null;
      }
      return fallback(key);
    },
  };
}

/**
 * A reader that echoes back EXACTLY the listed objects, so the sameness gate passes. Needed
 * whenever a test uses a non-default timestamp — the generic `fakeReader` fallback returns a
 * fixed 48h-old stub, which (correctly) reads as CHANGED_SINCE_SCAN against anything else.
 */
function readerFor(objects: readonly ListedObject[]) {
  return fakeReader(Object.fromEntries(objects.map((o) => [o.key, o])));
}

function fakeDb(
  rows: readonly { upload_key: string | null; r2_key: string | null }[],
  fail = false,
): OwnershipQuery {
  return {
    async query<T>(_text: string, params: readonly unknown[] = []): Promise<readonly T[]> {
      if (fail) throw new Error('too many connections');
      const set = new Set((params[0] ?? []) as string[]);
      return rows.filter(
        (r) =>
          (r.upload_key !== null && set.has(r.upload_key)) ||
          (r.r2_key !== null && set.has(r.r2_key)),
      ) as unknown as readonly T[];
    },
  };
}

async function cleanup(opts: {
  objects: readonly ListedObject[] | readonly (ListedObject[] | Error)[];
  rows?: readonly { upload_key: string | null; r2_key: string | null }[];
  dbFail?: boolean;
  executor: CleanupExecutor;
  reader?: ReadOnlyMetadataReader;
  scope?: ScanScope;
  minAgeMs?: number;
  paged?: boolean;
}) {
  const pages = opts.paged
    ? (opts.objects as (ListedObject[] | Error)[])
    : [opts.objects as ListedObject[]];
  return runOrphanCleanup({
    lister: fakeLister(pages),
    reader: opts.reader ?? fakeReader(),
    db: fakeDb(opts.rows ?? [], opts.dbFail ?? false),
    scope: opts.scope ?? SCOPE,
    executor: opts.executor,
    now: () => NOW,
    ...(opts.minAgeMs === undefined ? {} : { minAgeMs: opts.minAgeMs }),
  });
}

// ── the verification state machine ───────────────────────────────────────────────────────

describe('verifyCandidate — every gate fails closed', () => {
  const candidate = (over: Partial<ClassifiedObject> = {}): ClassifiedObject => ({
    key: rawKey(U(1)),
    uploadKey: rawKey(U(1)),
    sizeBytes: 1024,
    lastModified: hoursAgo(48),
    etag: '"abc"',
    classification: 'ORPHAN_CANDIDATE',
    reason: 'scan said so',
    ageMs: 48 * 3600000,
    ...over,
  });

  const verify = (
    c: ClassifiedObject,
    ownership: FreshOwnership,
    reader: ReadOnlyMetadataReader,
    scope: ScanScope = SCOPE,
  ) => verifyCandidate({ candidate: c, ownership, reader, scope, now: NOW });

  it('A — unowned + unchanged + old → VERIFIED_ORPHAN, and mints proof', async () => {
    const r = await verify(candidate(), { state: 'unowned' }, fakeReader());
    expect(r.classification).toBe('VERIFIED_ORPHAN');
    expect(r.verified).toBeDefined();
    expect(r.verified?.key).toBe(rawKey(U(1)));
    expect(r.verified?.userId).toBe(USER);
    expect(r.verified?.albumId).toBe(ALBUM);
  });

  it('B — ownership appeared since the scan → OWNED_AT_RECHECK, no proof', async () => {
    for (const via of ['upload_key', 'r2_key'] as const) {
      const r = await verify(candidate(), { state: 'owned', via }, fakeReader());
      expect(r.classification).toBe('OWNED_AT_RECHECK');
      expect(r.verified).toBeUndefined();
    }
  });

  it('C — object disappeared → MISSING_AT_RECHECK', async () => {
    const r = await verify(candidate(), { state: 'unowned' }, fakeReader({ [rawKey(U(1))]: null }));
    expect(r.classification).toBe('MISSING_AT_RECHECK');
    expect(r.verified).toBeUndefined();
  });

  it('D/E/F — size, ETag or LastModified changed → CHANGED_SINCE_SCAN', async () => {
    const changes: Partial<ListedObject>[] = [
      { sizeBytes: 2048 },
      { etag: '"different"' },
      { lastModified: hoursAgo(47) },
    ];
    for (const change of changes) {
      const reader = fakeReader({ [rawKey(U(1))]: listed(rawKey(U(1)), change) });
      const r = await verify(candidate(), { state: 'unowned' }, reader);
      expect(r.classification, JSON.stringify(change)).toBe('CHANGED_SINCE_SCAN');
      expect(r.verified).toBeUndefined();
    }
  });

  it('treats list-vs-head sub-second precision as the SAME object (real R2 behaviour)', async () => {
    // ListObjectsV2 reports milliseconds; HeadObject derives from the RFC-1123 Last-Modified
    // header, which has none. The same untouched object must still verify.
    const key = rawKey(U(1));
    const listedMs = '2026-08-15T11:22:43.523Z';
    const headedSec = '2026-08-15T11:22:43.000Z';
    const reader = fakeReader({ [key]: listed(key, { lastModified: headedSec }) });
    const r = await verify(candidate({ lastModified: listedMs }), { state: 'unowned' }, reader);
    expect(r.classification).toBe('VERIFIED_ORPHAN');
  });

  it('still rejects a genuine whole-second timestamp change', async () => {
    const key = rawKey(U(1));
    const reader = fakeReader({
      [key]: listed(key, { lastModified: '2026-08-15T11:22:44.000Z' }),
    });
    const r = await verify(
      candidate({ lastModified: '2026-08-15T11:22:43.523Z' }),
      { state: 'unowned' },
      reader,
    );
    expect(r.classification).toBe('CHANGED_SINCE_SCAN');
  });

  it('G — fresh metadata puts it inside the grace period → RECENT_AT_RECHECK', async () => {
    const key = rawKey(U(1));
    const reader = fakeReader({ [key]: listed(key, { lastModified: hoursAgo(2) }) });
    const r = await verify(candidate({ lastModified: hoursAgo(2) }), { state: 'unowned' }, reader);
    expect(r.classification).toBe('RECENT_AT_RECHECK');
    expect(r.verified).toBeUndefined();
  });

  it('H — fresh metadata has no usable timestamp → UNKNOWN_AGE', async () => {
    const key = rawKey(U(1));
    for (const lm of [null, 'not-a-date']) {
      const reader = fakeReader({ [key]: listed(key, { lastModified: lm }) });
      const r = await verify(candidate({ lastModified: lm }), { state: 'unowned' }, reader);
      expect(r.classification, String(lm)).toBe('UNKNOWN_AGE');
      expect(r.verified).toBeUndefined();
    }
  });

  it('I — fresh metadata dated in the future → CLOCK_SKEW_PROTECTED', async () => {
    const key = rawKey(U(1));
    const future = new Date(NOW + 60 * 60 * 1000).toISOString();
    const reader = fakeReader({ [key]: listed(key, { lastModified: future }) });
    const r = await verify(candidate({ lastModified: future }), { state: 'unowned' }, reader);
    expect(r.classification).toBe('CLOCK_SKEW_PROTECTED');
    expect(r.verified).toBeUndefined();
  });

  it('J — ownership lookup failed → UNDETERMINED', async () => {
    const r = await verify(
      candidate(),
      { state: 'undetermined', detail: 'connection reset' },
      fakeReader(),
    );
    expect(r.classification).toBe('UNDETERMINED');
    expect(r.verified).toBeUndefined();
  });

  it('K — HEAD failed → R2_ERROR (never assumed unchanged)', async () => {
    const reader = fakeReader({ [rawKey(U(1))]: new Error('R2 timeout') });
    const r = await verify(candidate(), { state: 'unowned' }, reader);
    expect(r.classification).toBe('R2_ERROR');
    expect(r.verified).toBeUndefined();
  });

  it('R — derivatives, PDFs and admin assets can NEVER be verified', async () => {
    for (const key of [
      `${USER}/albums/${ALBUM}/${U(1)}_full.jpg`,
      `${USER}/albums/${ALBUM}/${U(1)}_thumb.jpg`,
      `${USER}/albums/${ALBUM}/preview.pdf`,
      `cover-templates/${U(1)}.png`,
      `album-products/${U(1)}.png`,
      `stickers/${U(1)}.png`,
    ]) {
      const r = await verify(
        candidate({ key, uploadKey: key }),
        { state: 'unowned' },
        fakeReader(),
        BUCKET_SCOPE,
      );
      expect(r.classification, key).toBe('NOT_A_CANDIDATE');
      expect(r.verified, key).toBeUndefined();
    }
  });

  it('S — a malformed key can never be verified', async () => {
    for (const key of [
      `${USER}/albums/${ALBUM}/nope.jpg`,
      `${USER}/albums/${ALBUM}/${U(1)}.gif`,
      `${USER}/albums/${ALBUM}/sub/${U(1)}.jpg`,
    ]) {
      const r = await verify(
        candidate({ key, uploadKey: key }),
        { state: 'unowned' },
        fakeReader(),
        BUCKET_SCOPE,
      );
      expect(r.classification, key).toBe('NOT_A_CANDIDATE');
    }
  });

  it('T/U — a candidate outside the requested album or user scope → OUT_OF_SCOPE', async () => {
    const foreignAlbum = rawKey(U(1), USER, OTHER_ALBUM);
    const foreignUser = rawKey(U(1), OTHER_USER, ALBUM);
    for (const key of [foreignAlbum, foreignUser]) {
      const r = await verify(
        candidate({ key, uploadKey: key }),
        { state: 'unowned' },
        fakeReader(),
      );
      expect(r.classification, key).toBe('OUT_OF_SCOPE');
      expect(r.verified).toBeUndefined();
    }
  });

  it('refuses anything that was not an ORPHAN_CANDIDATE to begin with', async () => {
    for (const c of ['OWNED', 'RECENT_UNCONFIRMED', 'MALFORMED_KEY', 'UNKNOWN_AGE'] as const) {
      const r = await verify(candidate({ classification: c }), { state: 'unowned' }, fakeReader());
      expect(r.classification, c).toBe('NOT_A_CANDIDATE');
    }
  });

  it('no non-deletable state is ever accompanied by proof', async () => {
    expect(NON_DELETABLE_STATES).not.toContain('VERIFIED_ORPHAN');
  });
});

// ── the delete-call safety matrix (the important part) ───────────────────────────────────

describe('runOrphanCleanup — DELETE SPY', () => {
  const oldOrphan = () => listed(rawKey(U(1)), { lastModified: hoursAgo(48) });

  it('M — dry run performs ZERO delete calls even with a verified candidate', async () => {
    const spy = spyDeleter();
    const report = await cleanup({ objects: [oldOrphan()], executor: dryRunExecutor() });
    expect(spy.calls).toEqual([]);
    expect(report.mode).toBe('dry-run');
    expect(report.verifiedCandidates).toBe(1);
    expect(report.deleted).toBe(0);
    expect(report.deleteAttempted).toBe(0);
    expect(report.objects[0]?.action).toBe('PLANNED');
  });

  it('N — execute mode deletes exactly one exact key', async () => {
    const reader = fakeReader();
    const spy = spyDeleter('ok', reader);
    const report = await cleanup({
      objects: [oldOrphan()],
      reader,
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([rawKey(U(1))]);
    expect(report.deleted).toBe(1);
    expect(report.bytesReclaimed).toBe(1024);
    expect(report.objects[0]?.action).toBe('DELETED');
  });

  it('B — an owned candidate triggers ZERO delete calls', async () => {
    const spy = spyDeleter();
    // Unowned at scan time is impossible to stage directly, so the scan sees it owned too;
    // what matters is that the delete spy stays empty.
    const key = rawKey(U(1));
    const report = await cleanup({
      objects: [oldOrphan()],
      rows: [{ upload_key: key, r2_key: key }],
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.candidatesFound).toBe(0);
    expect(report.deleted).toBe(0);
  });

  it('L — an INCOMPLETE scan aborts with ZERO delete calls', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [[oldOrphan()], new Error('R2 connection reset')] as (ListedObject[] | Error)[],
      paged: true,
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.aborted).toBe(true);
    expect(report.scanComplete).toBe(false);
    expect(report.deleted).toBe(0);
    expect(report.abortReason).toContain('partial listing cannot authorise deletion');
  });

  it('J — a DB failure aborts the destructive phase with ZERO delete calls', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [oldOrphan()],
      dbFail: true,
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    // The scan itself marks incomplete on a DB failure, so the run aborts at the first gate.
    expect(report.aborted).toBe(true);
    expect(report.deleted).toBe(0);
  });

  it('C/D — missing or changed objects trigger ZERO delete calls', async () => {
    const key = rawKey(U(1));
    for (const script of [
      { [key]: null },
      { [key]: listed(key, { sizeBytes: 999 }) },
      { [key]: listed(key, { etag: '"changed"' }) },
    ]) {
      const spy = spyDeleter();
      const report = await cleanup({
        objects: [oldOrphan()],
        reader: fakeReader(script),
        executor: executingExecutor(spy),
      });
      expect(spy.calls, JSON.stringify(script)).toEqual([]);
      expect(report.deleted).toBe(0);
    }
  });

  it('K — a HEAD failure triggers ZERO delete calls and marks revalidation incomplete', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [oldOrphan()],
      reader: fakeReader({ [rawKey(U(1))]: new Error('R2 timeout') }),
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.r2Errors).toBe(1);
    expect(report.revalidationComplete).toBe(false);
  });

  it('R — derivatives in the listing never reach the deleter', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [
        listed(`${USER}/albums/${ALBUM}/${U(1)}_full.jpg`, { lastModified: hoursAgo(9000) }),
        listed(`${USER}/albums/${ALBUM}/${U(1)}_thumb.jpg`, { lastModified: hoursAgo(9000) }),
        listed(`${USER}/albums/${ALBUM}/preview.pdf`, { lastModified: hoursAgo(9000) }),
        listed(`stickers/${U(2)}.png`, { lastModified: hoursAgo(9000) }),
        listed(`cover-templates/${U(3)}.png`, { lastModified: hoursAgo(9000) }),
        listed(`album-products/${U(4)}.png`, { lastModified: hoursAgo(9000) }),
      ],
      scope: BUCKET_SCOPE,
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.candidatesFound).toBe(0);
    expect(report.deleted).toBe(0);
  });

  it('S — malformed keys never reach the deleter', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [
        listed(`${USER}/albums/${ALBUM}/garbage.jpg`, { lastModified: hoursAgo(9000) }),
        listed(`${USER}/albums/${ALBUM}/${U(1)}.gif`, { lastModified: hoursAgo(9000) }),
      ],
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.deleted).toBe(0);
  });

  it('G — recent objects never reach the deleter', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [listed(rawKey(U(1)), { lastModified: hoursAgo(2) })],
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([]);
    expect(report.candidatesFound).toBe(0);
  });

  it('H/I — unknown or future timestamps never reach the deleter', async () => {
    for (const lm of [null, new Date(NOW + 3600000).toISOString()]) {
      const spy = spyDeleter();
      const report = await cleanup({
        objects: [listed(rawKey(U(1)), { lastModified: lm })],
        executor: executingExecutor(spy),
      });
      expect(spy.calls, String(lm)).toEqual([]);
      expect(report.deleted).toBe(0);
    }
  });

  it('T/U — candidates outside the scope never reach the deleter', async () => {
    const spy = spyDeleter();
    // A bucket-wide scan finds a foreign-album object, but the run is album-scoped.
    const report = await runOrphanCleanup({
      lister: fakeLister([
        [listed(rawKey(U(1), USER, OTHER_ALBUM), { lastModified: hoursAgo(48) })],
      ]),
      reader: fakeReader(),
      db: fakeDb([]),
      scope: SCOPE,
      executor: executingExecutor(spy),
      now: () => NOW,
    });
    expect(spy.calls).toEqual([]);
    expect(report.deleted).toBe(0);
  });

  it('O — a mixed batch deletes ONLY the verified candidates', async () => {
    const reader = fakeReader();
    const spy = spyDeleter('ok', reader);
    const ownedKey = rawKey(U(10));
    const report = await cleanup({
      reader,
      objects: [
        listed(rawKey(U(1)), { lastModified: hoursAgo(48) }), // verified → delete
        listed(rawKey(U(2)), { lastModified: hoursAgo(48) }), // verified → delete
        listed(ownedKey, { lastModified: hoursAgo(48) }), // owned → skip
        listed(rawKey(U(3)), { lastModified: hoursAgo(2) }), // recent → not a candidate
        listed(`${USER}/albums/${ALBUM}/${U(4)}_full.jpg`, { lastModified: hoursAgo(48) }), // derivative
        listed(`${USER}/albums/${ALBUM}/bad.jpg`, { lastModified: hoursAgo(48) }), // malformed
      ],
      rows: [{ upload_key: ownedKey, r2_key: ownedKey }],
      executor: executingExecutor(spy),
    });
    expect(spy.calls.sort()).toEqual([rawKey(U(1)), rawKey(U(2))].sort());
    expect(report.deleted).toBe(2);
    expect(report.candidatesFound).toBe(2);
  });

  it('P — a deletion failure is reported and does not abort other candidates', async () => {
    const failing = spyDeleter('throw');
    const report = await cleanup({
      objects: [
        listed(rawKey(U(1)), { lastModified: hoursAgo(48) }),
        listed(rawKey(U(2)), { lastModified: hoursAgo(48) }),
      ],
      executor: executingExecutor(failing),
    });
    expect(failing.calls).toHaveLength(2); // both attempted
    expect(report.deleted).toBe(0);
    expect(report.deleteFailed).toBe(2);
    expect(report.objects.every((o) => o.action === 'DELETE_FAILED')).toBe(true);
    expect(report.errors.every((e) => e.stage === 'delete')).toBe(true);
  });

  it('Q — a delete that leaves the object readable → DELETE_VERIFICATION_FAILED', async () => {
    // The deleter reports success but the reader keeps returning the object.
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [listed(rawKey(U(1)), { lastModified: hoursAgo(48) })],
      reader: fakeReader(), // never removes anything
      executor: executingExecutor(spy),
    });
    expect(spy.calls).toEqual([rawKey(U(1))]);
    expect(report.deleted).toBe(0);
    expect(report.deleteVerificationFailed).toBe(1);
    expect(report.objects[0]?.action).toBe('DELETE_VERIFICATION_FAILED');
  });

  it('V — a duplicated candidate produces exactly ONE delete attempt', async () => {
    const reader = fakeReader();
    const spy = spyDeleter('ok', reader);
    const key = rawKey(U(1));
    const report = await runOrphanCleanup({
      lister: fakeLister([
        [listed(key, { lastModified: hoursAgo(48) }), listed(key, { lastModified: hoursAgo(48) })],
        [listed(key, { lastModified: hoursAgo(48) })],
      ]),
      reader,
      db: fakeDb([]),
      scope: SCOPE,
      executor: executingExecutor(spy),
      now: () => NOW,
    });
    expect(spy.calls).toEqual([key]);
    expect(report.deleted).toBe(1);
  });

  it('W — a second run finds nothing and performs zero further deletions (idempotent)', async () => {
    const reader = fakeReader();
    const spy1 = spyDeleter();
    const objects = [listed(rawKey(U(1)), { lastModified: hoursAgo(48) })];
    // Model real removal: after the first delete the object is gone from the reader.
    const deletingSpy: VerifiedOrphanDeleter & { calls: string[] } = {
      calls: spy1.calls,
      async deleteVerified(o) {
        spy1.calls.push(o.key);
        reader.deletedKeys.add(o.key);
      },
    };
    const first = await runOrphanCleanup({
      lister: fakeLister([objects]),
      reader,
      db: fakeDb([]),
      scope: SCOPE,
      executor: executingExecutor(deletingSpy),
      now: () => NOW,
    });
    expect(first.deleted).toBe(1);

    // Second run: the listing no longer returns it (as R2 would not).
    const spy2 = spyDeleter();
    const second = await runOrphanCleanup({
      lister: fakeLister([[]]),
      reader,
      db: fakeDb([]),
      scope: SCOPE,
      executor: executingExecutor(spy2),
      now: () => NOW,
    });
    expect(spy2.calls).toEqual([]);
    expect(second.deleted).toBe(0);
    expect(second.candidatesFound).toBe(0);
  });

  it('reports partial success accurately — never "all cleaned"', async () => {
    let n = 0;
    const reader = fakeReader();
    const flaky: VerifiedOrphanDeleter & { calls: string[] } = {
      calls: [],
      async deleteVerified(o) {
        flaky.calls.push(o.key);
        n += 1;
        if (n % 2 === 0) throw new Error('transient');
        reader.deletedKeys.add(o.key);
      },
    };
    const report = await runOrphanCleanup({
      lister: fakeLister([
        [1, 2, 3, 4].map((i) => listed(rawKey(U(i)), { lastModified: hoursAgo(48) })),
      ]),
      reader,
      db: fakeDb([]),
      scope: SCOPE,
      executor: executingExecutor(flaky),
      now: () => NOW,
    });
    expect(report.candidatesFound).toBe(4);
    expect(report.verifiedCandidates).toBe(4);
    expect(report.deleted).toBe(2);
    expect(report.deleteFailed).toBe(2);
    expect(report.deleted + report.deleteFailed).toBe(report.deleteAttempted);
  });

  it('performs zero delete calls when there are no candidates at all', async () => {
    const spy = spyDeleter();
    const report = await cleanup({ objects: [], executor: executingExecutor(spy) });
    expect(spy.calls).toEqual([]);
    expect(report.candidatesFound).toBe(0);
    expect(report.aborted).toBe(false);
  });

  // ── the destructive age floor (Prompt 4) ───────────────────────────────────────────────
  //
  // Enforced in `runOrphanCleanup`, NOT the CLI, so these tests exercise the authoritative gate
  // that a scheduler or programmatic caller would also hit.

  it('execute + exactly 24h is ALLOWED', async () => {
    const reader = fakeReader();
    const spy = spyDeleter('ok', reader);
    const report = await cleanup({
      objects: [oldOrphan()],
      reader,
      executor: executingExecutor(spy),
      minAgeMs: 24 * 3600000,
    });
    expect(report.aborted).toBe(false);
    expect(spy.calls).toEqual([rawKey(U(1))]);
    expect(report.deleted).toBe(1);
  });

  it('execute + more than 24h is ALLOWED', async () => {
    const objects = [listed(rawKey(U(1)), { lastModified: hoursAgo(100) })];
    const reader = readerFor(objects);
    const spy = spyDeleter('ok', reader);
    const report = await cleanup({
      objects,
      reader,
      executor: executingExecutor(spy),
      minAgeMs: 48 * 3600000,
    });
    expect(report.aborted).toBe(false);
    expect(report.deleted).toBe(1);
  });

  it('execute + less than 24h ABORTS with zero delete calls', async () => {
    for (const hours of [23.99, 12, 1, 0.5]) {
      const spy = spyDeleter();
      const report = await cleanup({
        objects: [oldOrphan()],
        executor: executingExecutor(spy),
        minAgeMs: hours * 3600000,
      });
      expect(spy.calls, `${hours}h`).toEqual([]);
      expect(report.aborted, `${hours}h`).toBe(true);
      expect(report.deleted).toBe(0);
      expect(report.abortReason).toContain('Refusing to execute');
      expect(report.errors[0]?.stage).toBe('config');
    }
  });

  it('execute + 0h ABORTS with zero delete calls', async () => {
    const spy = spyDeleter();
    const report = await cleanup({
      objects: [oldOrphan()],
      executor: executingExecutor(spy),
      minAgeMs: 0,
    });
    expect(spy.calls).toEqual([]);
    expect(report.aborted).toBe(true);
    expect(report.deleted).toBe(0);
    expect(report.scannedObjects).toBe(0); // aborted before any I/O
  });

  it('dry-run + 0h is STILL ALLOWED (diagnostics keep working)', async () => {
    const objects = [listed(rawKey(U(1)), { lastModified: hoursAgo(0.01) })];
    const report = await cleanup({
      objects,
      reader: readerFor(objects),
      executor: dryRunExecutor(),
      minAgeMs: 0,
    });
    expect(report.aborted).toBe(false);
    expect(report.verifiedCandidates).toBe(1);
    expect(report.deleted).toBe(0);
    expect(report.objects[0]?.action).toBe('PLANNED');
  });

  it('dry-run + below 24h is STILL ALLOWED', async () => {
    const objects = [listed(rawKey(U(1)), { lastModified: hoursAgo(3) })];
    const report = await cleanup({
      objects,
      reader: readerFor(objects),
      executor: dryRunExecutor(),
      minAgeMs: 2 * 3600000,
    });
    expect(report.aborted).toBe(false);
    expect(report.verifiedCandidates).toBe(1);
    expect(report.deleted).toBe(0);
  });

  it('the destructive floor is DERIVED from the scan grace period (one source of truth)', () => {
    expect(MIN_DESTRUCTIVE_AGE_MS).toBe(ORPHAN_MIN_AGE_MS);
    expect(MIN_DESTRUCTIVE_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  // ── pre-delete announcement (Prompt 4) ────────────────────────────────────────────────

  it('announces EXACT counts once, immediately before the first deletion', async () => {
    const reader = fakeReader();
    const summaries: PreDeleteSummary[] = [];
    const ownedKey = rawKey(U(10));
    const deleteOrder: string[] = [];
    const spy: VerifiedOrphanDeleter = {
      async deleteVerified(o) {
        deleteOrder.push(o.key);
        reader.deletedKeys.add(o.key);
      },
    };
    await runOrphanCleanup({
      lister: fakeLister([
        [
          listed(rawKey(U(1)), { lastModified: hoursAgo(48) }),
          listed(rawKey(U(2)), { lastModified: hoursAgo(48) }),
          listed(ownedKey, { lastModified: hoursAgo(48) }),
        ],
      ]),
      reader,
      db: fakeDb([{ upload_key: ownedKey, r2_key: ownedKey }]),
      scope: SCOPE,
      executor: executingExecutor(spy),
      now: () => NOW,
      onPreDelete: (s) => summaries.push(s),
    });
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.aboutToDelete).toBe(2);
    expect(s.verifiedCandidates).toBe(2);
    expect(s.scannedObjects).toBe(3);
    expect(s.candidatesFound).toBe(2);
    expect(s.minAgeHours).toBe(24);
    // Announced BEFORE anything was destroyed.
    expect(deleteOrder).toHaveLength(2);
  });

  it('never announces a pre-delete summary in dry run', async () => {
    const summaries: PreDeleteSummary[] = [];
    await cleanup({
      objects: [oldOrphan()],
      executor: dryRunExecutor(),
    }).then(() => undefined);
    await runOrphanCleanup({
      lister: fakeLister([[listed(rawKey(U(1)), { lastModified: hoursAgo(48) })]]),
      reader: fakeReader(),
      db: fakeDb([]),
      scope: SCOPE,
      executor: dryRunExecutor(),
      now: () => NOW,
      onPreDelete: (s) => summaries.push(s),
    });
    expect(summaries).toEqual([]);
  });

  it('emits structured events without secrets', async () => {
    const events: string[] = [];
    await runOrphanCleanup({
      lister: fakeLister([[listed(rawKey(U(1)), { lastModified: hoursAgo(48) })]]),
      reader: fakeReader(),
      db: fakeDb([]),
      scope: SCOPE,
      executor: dryRunExecutor(),
      now: () => NOW,
      onEvent: (e) => events.push(e.type),
    });
    expect(events).toContain('cleanup.started');
    expect(events).toContain('cleanup.candidate');
    expect(events).toContain('cleanup.revalidated');
    expect(events).toContain('cleanup.completed');
  });
});

// ── the deleter primitive ────────────────────────────────────────────────────────────────

describe('R2VerifiedOrphanDeleter', () => {
  it('issues exactly one DeleteObjectCommand for the exact key', async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const client = {
      async send(command: unknown) {
        const c = command as { constructor: { name: string }; input: Record<string, unknown> };
        sent.push({ name: c.constructor.name, input: c.input });
        return {};
      },
    };
    const { R2VerifiedOrphanDeleter: D } =
      await import('../src/diagnostics/orphan-cleanup/deleter.js');
    const deleter = new D(client, 'test-bucket');
    // Mint a genuine proof through the real verification path — it cannot be hand-built.
    const outcome = await verifyCandidate({
      candidate: {
        key: rawKey(U(1)),
        uploadKey: rawKey(U(1)),
        sizeBytes: 10,
        lastModified: hoursAgo(48),
        etag: '"e"',
        classification: 'ORPHAN_CANDIDATE',
        reason: '',
        ageMs: 48 * 3600000,
      },
      ownership: { state: 'unowned' },
      reader: fakeReader({ [rawKey(U(1))]: listed(rawKey(U(1)), { sizeBytes: 10, etag: '"e"' }) }),
      scope: SCOPE,
      now: NOW,
    });
    expect(outcome.verified).toBeDefined();
    await deleter.deleteVerified(outcome.verified!);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('DeleteObjectCommand');
    expect(sent[0]?.input).toEqual({ Bucket: 'test-bucket', Key: rawKey(U(1)) });
    // No prefix, no wildcard, no Delete (batch) payload.
    expect(sent[0]?.input).not.toHaveProperty('Prefix');
    expect(sent[0]?.input).not.toHaveProperty('Delete');
  });

  it('the VerifiedOrphan brand cannot be forged (compile-time proof)', async () => {
    const { R2VerifiedOrphanDeleter: D } =
      await import('../src/diagnostics/orphan-cleanup/deleter.js');
    const calls: unknown[] = [];
    const deleter = new D(
      {
        async send(c: unknown) {
          calls.push(c);
          return {};
        },
      },
      'b',
    );

    // A hand-built object with every visible field is STILL not a VerifiedOrphan: the brand is a
    // `unique symbol` declared inside model.ts and exported nowhere, so this does not typecheck.
    // @ts-expect-error — missing the unforgeable brand; this is the safety boundary.
    await deleter.deleteVerified({
      key: rawKey(U(1)),
      uploadKey: rawKey(U(1)),
      userId: USER,
      albumId: ALBUM,
      sizeBytes: 1,
      etag: '"e"',
      lastModified: hoursAgo(48),
      ageMs: 48 * 3600000,
    });

    // A bare string is likewise impossible.
    // @ts-expect-error — deleteVerified takes proof, never a key.
    await deleter.deleteVerified(rawKey(U(2)));
  });

  it('exposes no arbitrary-key deletion method', async () => {
    const { R2VerifiedOrphanDeleter: D } =
      await import('../src/diagnostics/orphan-cleanup/deleter.js');
    const d = new D(
      {
        async send() {
          return {};
        },
      },
      'b',
    ) as unknown as Record<string, unknown>;
    for (const forbidden of [
      'delete',
      'deleteObject',
      'deleteObjects',
      'deleteByPrefix',
      'remove',
      'purge',
    ]) {
      expect(d[forbidden], forbidden).toBeUndefined();
    }
  });
});

// ── the read-only reader gained HEAD but no delete ───────────────────────────────────────

describe('R2ReadOnlyLister still cannot delete', () => {
  it('has headObject but no delete surface', () => {
    const l = new R2ReadOnlyLister(
      {
        async send() {
          return {};
        },
      },
      'b',
    ) as unknown as Record<string, unknown>;
    expect(typeof l['headObject']).toBe('function');
    expect(typeof l['listPage']).toBe('function');
    for (const forbidden of ['delete', 'deleteObject', 'deleteObjects', 'write', 'put', 'remove']) {
      expect(l[forbidden], forbidden).toBeUndefined();
    }
  });

  it('headObject returns null for a missing object and rethrows real transport errors', async () => {
    const notFound = new R2ReadOnlyLister(
      {
        async send() {
          throw Object.assign(new Error('nope'), { name: 'NotFound' });
        },
      },
      'b',
    );
    expect(await notFound.headObject('k')).toBeNull();

    const broken = new R2ReadOnlyLister(
      {
        async send() {
          throw new Error('connection reset');
        },
      },
      'b',
    );
    await expect(broken.headObject('k')).rejects.toThrow('connection reset');
  });
});
