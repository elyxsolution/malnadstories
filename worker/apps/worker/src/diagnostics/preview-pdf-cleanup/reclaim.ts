/**
 * PREVIEW-PDF RECLAMATION — scan → verify → (optionally) delete.
 *
 * Same two-phase shape as the raw-upload cleanup: a scan gathers evidence, then EVERY gate is
 * asked again from scratch immediately before each deletion. A scan result is evidence, never
 * authorisation.
 *
 *   preview key parse   — is it structurally a preview PDF, outside admin namespaces?
 *   ownership (scan)    — no `album_pdfs` row names it AND the album is gone?
 *   age (scan)          — older than the grace period, and not future-dated?
 *        │
 *        ▼  ORPHAN_CANDIDATE
 *   ownership (fresh)   — re-asked at deletion time; a row or a resurrected album refuses
 *   R2 recheck (fresh)  — same size / ETag / LastModified?
 *   age (fresh)         — recomputed from the fresh timestamp
 *        ▼
 *   VERIFIED_ORPHAN     — the only deletable state
 *
 * EVERY GATE FAILS CLOSED. A DB error is not "no owner"; a HEAD failure is not "unchanged"; a
 * missing timestamp is not "old enough".
 */

import { randomUUID } from 'node:crypto';
import { CLOCK_SKEW_ALLOWANCE_MS, ORPHAN_MIN_AGE_MS } from '../orphan-scan/index.js';
import type { ListedObject } from '../orphan-scan/classify.js';
import type { ReadOnlyObjectLister, ReadOnlyMetadataReader } from '../orphan-scan/object-lister.js';
import { parsePreviewPdfKey, previewPdfKeyFor } from './preview-key.js';
import {
  MIN_DESTRUCTIVE_AGE_MS,
  PREVIEW_BRAND,
  type PreviewCleanupReport,
  type PreviewClassification,
  type PreviewObjectRecord,
  type RevalidatedPreviewClassification,
  type VerifiedPreviewOrphan,
} from './model.js';
import { lookupPreviewOwnership, type PreviewOwnershipQuery } from './ownership.js';
import type { PreviewExecutor } from './executor.js';

/** Truncate an ISO timestamp to whole seconds (List gives ms, Head gives seconds — see verify.ts). */
function toSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function sameObject(a: ListedObject, b: ListedObject): boolean {
  if (a.sizeBytes !== b.sizeBytes) return false;
  if (a.etag !== null && b.etag !== null && a.etag !== b.etag) return false;
  const ta = a.lastModified === null ? null : toSeconds(a.lastModified);
  const tb = b.lastModified === null ? null : toSeconds(b.lastModified);
  if (ta === null || tb === null) return true; // abstain rather than claim a change we can't prove
  return ta === tb;
}

export interface ReclaimOptions {
  readonly lister: ReadOnlyObjectLister;
  readonly reader: ReadOnlyMetadataReader;
  readonly db: PreviewOwnershipQuery;
  readonly executor: PreviewExecutor;
  readonly minAgeMs?: number;
  readonly now?: () => number;
}

export async function reclaimPreviewPdfs(opts: ReclaimOptions): Promise<PreviewCleanupReport> {
  const started = Date.now();
  const now = opts.now ?? (() => Date.now());
  const minAgeMs = opts.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const mode = opts.executor.mode;
  const errors: { stage: string; message: string; key?: string }[] = [];
  const records: PreviewObjectRecord[] = [];

  // ── HARD FLOOR: the destructive mode never accepts a grace period below the shared minimum. ──
  if (mode === 'execute' && minAgeMs < MIN_DESTRUCTIVE_AGE_MS) {
    return emptyReport({
      started,
      mode,
      minAgeMs,
      aborted: true,
      abortReason: `--execute requires --min-age-hours >= ${MIN_DESTRUCTIVE_AGE_MS / 3600000}`,
      scanComplete: false,
    });
  }

  // ── PHASE 1: scan ──────────────────────────────────────────────────────────────────────
  let scanned = 0;
  let scanComplete = true;
  // Declared up here, not beside phase 2: the ownership-failure path returns via `finish()`
  // BEFORE phase 2 is reached, and a `let` declared later would be in its temporal dead zone —
  // turning the fail-closed branch into a ReferenceError. (Caught by the DB-failure test.)
  let revalidationComplete = true;
  // `candidates` and `tally` are hoisted for the same reason: `finish()` reads both, and the
  // ownership-failure path calls it before phase 2 would have declared them.
  const candidates: { key: string; userId: string; albumId: string; listed: ListedObject }[] = [];
  const tally = {
    verified: 0, ownedAtRecheck: 0, albumExistsAtRecheck: 0, missingAtRecheck: 0,
    changedSinceScan: 0, recentAtRecheck: 0, unknownAge: 0, clockSkew: 0, undetermined: 0,
    r2Errors: 0, deleteAttempted: 0, deleted: 0, deleteFailed: 0,
    deleteVerificationFailed: 0, skipped: 0, bytes: 0,
  };
  const seen: { key: string; userId: string; albumId: string; listed: ListedObject }[] = [];
  const counts = {
    owned: 0, albumStillExists: 0, recentUnconfirmed: 0, unknownAge: 0,
    clockSkewProtected: 0, malformed: 0, undetermined: 0,
  };

  try {
    let token: string | null = null;
    do {
      const page = await opts.lister.listPage({ prefix: '', continuationToken: token, maxKeys: 1000 });
      for (const o of page.objects) {
        scanned += 1;
        const parsed = parsePreviewPdfKey(o.key);
        if (!parsed.ok) {
          if (parsed.rejection === 'malformed') {
            counts.malformed += 1;
            records.push(record(o, null, null, 'MALFORMED', parsed.detail));
          }
          continue; // admin namespaces and other object classes are silently out of scope
        }
        // Defence in depth: the parsed identity must round-trip to the exact input key.
        if (previewPdfKeyFor(parsed.value.userId, parsed.value.albumId) !== o.key) {
          counts.malformed += 1;
          records.push(record(o, null, null, 'MALFORMED', 'parsed identity does not round-trip'));
          continue;
        }
        seen.push({ ...parsed.value, listed: o });
      }
      token = page.nextToken;
    } while (token !== null);
  } catch (e) {
    scanComplete = false;
    errors.push({ stage: 'scan', message: message(e) });
  }

  let ownership;
  try {
    ownership = await lookupPreviewOwnership(opts.db, seen.map((s) => ({ key: s.key, albumId: s.albumId })));
  } catch (e) {
    scanComplete = false;
    errors.push({ stage: 'ownership', message: message(e) });
    for (const s of seen) {
      counts.undetermined += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'UNDETERMINED', 'ownership lookup failed'));
    }
    return finish();
  }

  for (const s of seen) {
    const verdict = ownership.verdicts.get(s.key);
    if (verdict === undefined) {
      counts.undetermined += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'UNDETERMINED', 'no verdict returned'));
      continue;
    }
    if (verdict.state === 'owned') {
      counts.owned += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'OWNED', 'album_pdfs.r2_key names this object'));
      continue;
    }
    if (verdict.state === 'album-exists') {
      counts.albumStillExists += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'ALBUM_STILL_EXISTS',
        'album still exists — a render may be in flight; recovery can still adopt this object'));
      continue;
    }
    const age = ageOf(s.listed, now());
    if (age === null) {
      counts.unknownAge += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'UNKNOWN_AGE', 'no usable LastModified'));
      continue;
    }
    if (age < -CLOCK_SKEW_ALLOWANCE_MS) {
      counts.clockSkewProtected += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'CLOCK_SKEW_PROTECTED', 'future-dated beyond skew'));
      continue;
    }
    if (age < minAgeMs) {
      counts.recentUnconfirmed += 1;
      records.push(record(s.listed, s.userId, s.albumId, 'RECENT_UNCONFIRMED',
        `age ${Math.round(age / 3600000)}h < grace period`, age));
      continue;
    }
    candidates.push(s);
  }

  // ── PHASE 2: revalidate each candidate from scratch, then act ─────────────────────────

  for (const c of candidates) {
    let outcome: RevalidatedPreviewClassification;
    let reason: string;
    let fresh: ListedObject | null = null;
    let verified: VerifiedPreviewOrphan | null = null;
    let error: string | null = null;

    try {
      // Gate 1 — ownership, re-asked NOW.
      const freshOwnership = await lookupPreviewOwnership(opts.db, [{ key: c.key, albumId: c.albumId }]);
      const v = freshOwnership.verdicts.get(c.key);
      if (v === undefined) {
        outcome = 'UNDETERMINED';
        reason = 'no fresh ownership verdict';
      } else if (v.state === 'owned') {
        outcome = 'OWNED_AT_RECHECK';
        reason = 'an album_pdfs row now names this key';
      } else if (v.state === 'album-exists') {
        outcome = 'ALBUM_EXISTS_AT_RECHECK';
        reason = 'the album exists at recheck';
      } else {
        // Gate 2 — the object, re-read NOW.
        fresh = await opts.reader.headObject(c.key);
        if (fresh === null) {
          outcome = 'MISSING_AT_RECHECK';
          reason = 'object no longer exists';
        } else if (!sameObject(c.listed, fresh)) {
          outcome = 'CHANGED_SINCE_SCAN';
          reason = 'size/ETag/LastModified moved since the scan';
        } else {
          // Gate 3 — age, recomputed from the FRESH timestamp.
          const age = ageOf(fresh, now());
          if (age === null) {
            outcome = 'UNKNOWN_AGE';
            reason = 'fresh metadata carried no usable timestamp';
          } else if (age < -CLOCK_SKEW_ALLOWANCE_MS) {
            outcome = 'CLOCK_SKEW_PROTECTED';
            reason = 'fresh metadata is future-dated beyond skew';
          } else if (age < minAgeMs) {
            outcome = 'RECENT_AT_RECHECK';
            reason = 'fresh metadata puts it back inside the grace period';
          } else {
            outcome = 'VERIFIED_ORPHAN';
            reason = 'no album_pdfs row names it, the album is gone, unchanged, past the grace period';
            verified = {
              [PREVIEW_BRAND]: true,
              key: c.key,
              userId: c.userId,
              albumId: c.albumId,
              noPdfRowReferencing: true,
              albumAbsent: true,
              sizeBytes: fresh.sizeBytes,
              etag: fresh.etag,
              lastModified: fresh.lastModified ?? '',
              ageMs: age,
            } as VerifiedPreviewOrphan;
          }
        }
      }
    } catch (e) {
      revalidationComplete = false;
      outcome = 'R2_ERROR';
      reason = 'revalidation failed';
      error = message(e);
      errors.push({ stage: 'revalidate', message: error, key: c.key });
    }

    let action: PreviewObjectRecord['action'] = 'SKIPPED';
    if (outcome === 'VERIFIED_ORPHAN' && verified !== null) {
      tally.verified += 1;
      if (opts.executor.mode === 'dry-run') {
        action = 'PLANNED';
      } else {
        tally.deleteAttempted += 1;
        try {
          await opts.executor.deleter.deletePreviewVerified(verified);
          // A DeleteObject that returns without throwing is not proof — re-head the key.
          const after = await opts.reader.headObject(c.key);
          if (after === null) {
            action = 'DELETED';
            tally.deleted += 1;
            tally.bytes += verified.sizeBytes ?? 0;
          } else {
            action = 'DELETE_VERIFICATION_FAILED';
            tally.deleteVerificationFailed += 1;
          }
        } catch (e) {
          action = 'DELETE_FAILED';
          tally.deleteFailed += 1;
          error = message(e);
          errors.push({ stage: 'delete', message: error, key: c.key });
        }
      }
    } else {
      tally.skipped += 1;
      if (outcome === 'OWNED_AT_RECHECK') tally.ownedAtRecheck += 1;
      if (outcome === 'ALBUM_EXISTS_AT_RECHECK') tally.albumExistsAtRecheck += 1;
      if (outcome === 'MISSING_AT_RECHECK') tally.missingAtRecheck += 1;
      if (outcome === 'CHANGED_SINCE_SCAN') tally.changedSinceScan += 1;
      if (outcome === 'RECENT_AT_RECHECK') tally.recentAtRecheck += 1;
      if (outcome === 'R2_ERROR') tally.r2Errors += 1;
      if (outcome === 'UNDETERMINED') tally.undetermined += 1;
    }

    records.push({
      key: c.key,
      userId: c.userId,
      albumId: c.albumId,
      initialClassification: 'ORPHAN_CANDIDATE',
      revalidatedClassification: outcome,
      sizeBytes: (fresh ?? c.listed).sizeBytes,
      lastModified: (fresh ?? c.listed).lastModified,
      ageMs: verified?.ageMs ?? null,
      action,
      reason,
      error,
    });
  }

  return finish();

  function finish(): PreviewCleanupReport {
    return {
      runId: randomUUID(),
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      mode,
      minAgeHours: minAgeMs / 3600000,
      scanComplete,
      revalidationComplete,
      aborted: false,
      abortReason: null,
      scannedObjects: scanned,
      previewPdfsSeen: seen.length,
      owned: counts.owned,
      albumStillExists: counts.albumStillExists,
      recentUnconfirmed: counts.recentUnconfirmed,
      unknownAge: counts.unknownAge,
      clockSkewProtected: counts.clockSkewProtected,
      malformed: counts.malformed,
      undetermined: counts.undetermined,
      candidates: candidates.length,
      verifiedCandidates: tally.verified,
      ownedAtRecheck: tally.ownedAtRecheck,
      albumExistsAtRecheck: tally.albumExistsAtRecheck,
      missingAtRecheck: tally.missingAtRecheck,
      changedSinceScan: tally.changedSinceScan,
      recentAtRecheck: tally.recentAtRecheck,
      r2Errors: tally.r2Errors,
      deleteAttempted: tally.deleteAttempted,
      deleted: tally.deleted,
      deleteFailed: tally.deleteFailed,
      deleteVerificationFailed: tally.deleteVerificationFailed,
      skipped: tally.skipped,
      bytesReclaimed: tally.bytes,
      errors,
      objects: records,
    };
  }

  function record(
    o: ListedObject,
    userId: string | null,
    albumId: string | null,
    cls: PreviewClassification,
    reason: string,
    ageMs: number | null = null,
  ): PreviewObjectRecord {
    return {
      key: o.key, userId, albumId,
      initialClassification: cls,
      revalidatedClassification: null,
      sizeBytes: o.sizeBytes, lastModified: o.lastModified, ageMs,
      action: null, reason, error: null,
    };
  }
}

function ageOf(o: ListedObject, nowMs: number): number | null {
  if (o.lastModified === null) return null;
  const t = Date.parse(o.lastModified);
  return Number.isFinite(t) ? nowMs - t : null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyReport(o: {
  started: number; mode: 'dry-run' | 'execute'; minAgeMs: number;
  aborted: boolean; abortReason: string | null; scanComplete: boolean;
}): PreviewCleanupReport {
  return {
    runId: randomUUID(), generatedAt: new Date().toISOString(), durationMs: Date.now() - o.started,
    mode: o.mode, minAgeHours: o.minAgeMs / 3600000, scanComplete: o.scanComplete,
    revalidationComplete: false, aborted: o.aborted, abortReason: o.abortReason,
    scannedObjects: 0, previewPdfsSeen: 0, owned: 0, albumStillExists: 0, recentUnconfirmed: 0,
    unknownAge: 0, clockSkewProtected: 0, malformed: 0, undetermined: 0, candidates: 0,
    verifiedCandidates: 0, ownedAtRecheck: 0, albumExistsAtRecheck: 0, missingAtRecheck: 0,
    changedSinceScan: 0, recentAtRecheck: 0, r2Errors: 0, deleteAttempted: 0, deleted: 0,
    deleteFailed: 0, deleteVerificationFailed: 0, skipped: 0, bytesReclaimed: 0,
    errors: [], objects: [],
  };
}
