/**
 * THE CLEANUP ORCHESTRATOR — scan → abort checks → batched fresh recheck → per-candidate
 * verification → exact-key deletion → post-delete verification → report.
 *
 * IT REUSES THE PROMPT-2 DETECTOR VERBATIM. `runOrphanScan` is the single authoritative
 * definition of ORPHAN_CANDIDATE; nothing here re-implements parsing, classification, the grace
 * period, or the clock-skew rule. This module adds only what deletion requires: a second,
 * independent set of gates and the destructive step behind them.
 *
 * THREE PLACES IT REFUSES TO PROCEED AT ALL (before any object is touched):
 *   1. `scanComplete === false` — a partial listing cannot authorise deletion, because the
 *      objects it did not see might be the ones that matter.
 *   2. The scan reported any error at all.
 *   3. The batched fresh ownership recheck failed — a database outage is not "no rows exist",
 *      and it makes the whole candidate set uncertain rather than just one entry.
 */

import { randomUUID } from 'node:crypto';
import {
  ORPHAN_MIN_AGE_MS,
  lookupOwnership,
  runOrphanScan,
  type ClassifiedObject,
  type OwnershipQuery,
  type ReadOnlyObjectLister,
  type ScanScope,
} from '../orphan-scan/index.js';
import type { ReadOnlyMetadataReader } from '../orphan-scan/object-lister.js';
import type { CleanupExecutor } from './executor.js';
import { verifyCandidate, type FreshOwnership } from './verify.js';
import type { VerifiedOrphan } from './model.js';
import { MIN_DESTRUCTIVE_AGE_MS } from './model.js';
import type {
  CleanupAction,
  CleanupError,
  CleanupObjectRecord,
  CleanupReport,
  RevalidatedClassification,
} from './model.js';

/**
 * The counts an operator sees IMMEDIATELY BEFORE the first delete call, once every candidate has
 * been revalidated. Exists so the destructive banner can state the exact number of objects about
 * to be destroyed, rather than an estimate made before verification ran.
 */
export interface PreDeleteSummary {
  readonly cleanupId: string;
  readonly scopeKind: string;
  readonly prefix: string;
  readonly bucketWide: boolean;
  readonly minAgeHours: number;
  readonly scannedObjects: number;
  readonly candidatesFound: number;
  readonly verifiedCandidates: number;
  /** The exact count of objects that will now be deleted. */
  readonly aboutToDelete: number;
  readonly protectedCount: number;
}

export interface CleanupOptions {
  readonly lister: ReadOnlyObjectLister;
  readonly reader: ReadOnlyMetadataReader;
  readonly db: OwnershipQuery;
  readonly scope: ScanScope;
  readonly executor: CleanupExecutor;
  readonly minAgeMs?: number;
  readonly clockSkewAllowanceMs?: number;
  readonly now?: () => number;
  /** Structured event sink. Never receives secrets or signed URLs. */
  readonly onEvent?: (event: CleanupEvent) => void;
  /**
   * Called ONCE in execute mode, after every candidate has been revalidated and immediately
   * before the first delete. This is what lets the destructive banner state an exact count.
   * Never called in dry run — there is nothing to announce.
   */
  readonly onPreDelete?: (summary: PreDeleteSummary) => void;
}

export type CleanupEvent =
  | {
      readonly type: 'cleanup.started';
      readonly cleanupId: string;
      readonly mode: string;
      readonly scope: string;
    }
  | { readonly type: 'cleanup.aborted'; readonly cleanupId: string; readonly reason: string }
  | { readonly type: 'cleanup.candidate'; readonly cleanupId: string; readonly key: string }
  | {
      readonly type: 'cleanup.revalidated';
      readonly cleanupId: string;
      readonly key: string;
      readonly classification: RevalidatedClassification;
    }
  | {
      readonly type: 'cleanup.skipped';
      readonly cleanupId: string;
      readonly key: string;
      readonly reason: string;
    }
  | {
      readonly type: 'cleanup.deleted';
      readonly cleanupId: string;
      readonly key: string;
      readonly bytes: number;
    }
  | {
      readonly type: 'cleanup.delete_failed';
      readonly cleanupId: string;
      readonly key: string;
      readonly error: string;
    }
  | {
      readonly type: 'cleanup.completed';
      readonly cleanupId: string;
      readonly deleted: number;
      readonly skipped: number;
      readonly failed: number;
    };

export async function runOrphanCleanup(options: CleanupOptions): Promise<CleanupReport> {
  const cleanupId = randomUUID();
  const startedAt = Date.now();
  const now = options.now ?? (() => Date.now());
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const emit = (e: CleanupEvent): void => options.onEvent?.(e);
  const mode = options.executor.mode;

  emit({ type: 'cleanup.started', cleanupId, mode, scope: options.scope.prefix });

  const errors: CleanupError[] = [];
  const records: CleanupObjectRecord[] = [];

  /**
   * ── ABORT GATE 0: THE DESTRUCTIVE AGE FLOOR ───────────────────────────────────────────────
   *
   * Checked HERE, in the execution layer, rather than in the CLI — so a programmatic caller,
   * a future scheduler, or a test gets the same protection the command line does. It runs
   * BEFORE the scan, because a misconfigured destructive run should cost zero I/O and reach no
   * object at all, not merely stop short of deleting one.
   *
   * Dry run is exempt by construction: it holds no deleter, so a 0h diagnostic destroys nothing.
   */
  if (mode === 'execute' && minAgeMs < MIN_DESTRUCTIVE_AGE_MS) {
    const reason =
      `Refusing to execute with a ${minAgeMs / 3600000}h grace period: destructive runs require at least ` +
      `${MIN_DESTRUCTIVE_AGE_MS / 3600000}h, because a younger object may be an upload whose confirm is ` +
      `still in flight. Re-run without --execute to inspect this age range as a dry run.`;
    errors.push({ stage: 'config', message: reason });
    emit({ type: 'cleanup.aborted', cleanupId, reason });
    emit({ type: 'cleanup.completed', cleanupId, deleted: 0, skipped: 0, failed: 0 });
    return {
      cleanupId,
      scanId: '(scan not run — aborted on the destructive age floor)',
      generatedAt: new Date(now()).toISOString(),
      durationMs: Date.now() - startedAt,
      mode,
      scope: options.scope,
      minAgeHours: minAgeMs / 3600000,
      scanComplete: false,
      revalidationComplete: false,
      aborted: true,
      abortReason: reason,
      scannedObjects: 0,
      candidatesFound: 0,
      verifiedCandidates: 0,
      ownedAtRecheck: 0,
      missingAtRecheck: 0,
      changedSinceScan: 0,
      recentAtRecheck: 0,
      unknownAge: 0,
      clockSkewProtected: 0,
      outOfScope: 0,
      undetermined: 0,
      r2Errors: 0,
      deleteAttempted: 0,
      deleted: 0,
      deleteFailed: 0,
      deleteVerificationFailed: 0,
      skipped: 0,
      bytesReclaimed: 0,
      errors,
      objects: [],
    };
  }

  // ── PHASE 1: the Prompt-2 scan, unmodified. ───────────────────────────────────────────────
  const scan = await runOrphanScan({
    lister: options.lister,
    db: options.db,
    scope: options.scope,
    minAgeMs,
    ...(options.clockSkewAllowanceMs === undefined
      ? {}
      : { clockSkewAllowanceMs: options.clockSkewAllowanceMs }),
    now,
  });

  const finish = (
    aborted: boolean,
    abortReason: string | null,
    revalidationComplete: boolean,
  ): CleanupReport => {
    const count = (c: RevalidatedClassification): number =>
      records.reduce((n, r) => (r.revalidatedClassification === c ? n + 1 : n), 0);
    const actions = (a: CleanupAction): number =>
      records.reduce((n, r) => (r.action === a ? n + 1 : n), 0);
    const deleted = actions('DELETED');
    const report: CleanupReport = {
      cleanupId,
      scanId: scan.scanId,
      generatedAt: new Date(now()).toISOString(),
      durationMs: Date.now() - startedAt,
      mode,
      scope: options.scope,
      minAgeHours: minAgeMs / 3600000,
      scanComplete: scan.scanComplete,
      revalidationComplete,
      aborted,
      abortReason,
      scannedObjects: scan.scanned,
      candidatesFound: scan.orphanCandidates,
      verifiedCandidates: count('VERIFIED_ORPHAN'),
      ownedAtRecheck: count('OWNED_AT_RECHECK'),
      missingAtRecheck: count('MISSING_AT_RECHECK'),
      changedSinceScan: count('CHANGED_SINCE_SCAN'),
      recentAtRecheck: count('RECENT_AT_RECHECK'),
      unknownAge: count('UNKNOWN_AGE'),
      clockSkewProtected: count('CLOCK_SKEW_PROTECTED'),
      outOfScope: count('OUT_OF_SCOPE'),
      undetermined: count('UNDETERMINED'),
      r2Errors: count('R2_ERROR'),
      deleteAttempted: deleted + actions('DELETE_FAILED') + actions('DELETE_VERIFICATION_FAILED'),
      deleted,
      deleteFailed: actions('DELETE_FAILED'),
      deleteVerificationFailed: actions('DELETE_VERIFICATION_FAILED'),
      skipped: actions('SKIPPED') + actions('PLANNED'),
      bytesReclaimed: records.reduce(
        (n, r) => (r.action === 'DELETED' ? n + (r.finalSize ?? 0) : n),
        0,
      ),
      errors,
      objects: records,
    };
    emit({
      type: 'cleanup.completed',
      cleanupId,
      deleted: report.deleted,
      skipped: report.skipped,
      failed: report.deleteFailed + report.deleteVerificationFailed,
    });
    return report;
  };

  // ── ABORT GATE 1: an incomplete scan can never authorise deletion. ────────────────────────
  if (!scan.scanComplete) {
    const reason = `The scan did not complete (${scan.errors.map((e) => `${e.stage}: ${e.message}`).join('; ')}). A partial listing cannot authorise deletion.`;
    errors.push(...scan.errors.map((e) => ({ stage: 'scan' as const, message: e.message })));
    emit({ type: 'cleanup.aborted', cleanupId, reason });
    return finish(true, reason, false);
  }

  const candidates = scan.objects.filter((o) => o.classification === 'ORPHAN_CANDIDATE');
  for (const c of candidates) emit({ type: 'cleanup.candidate', cleanupId, key: c.key });

  if (candidates.length === 0) {
    // Nothing to do. Deliberately performs ZERO delete calls and ZERO further reads.
    return finish(false, null, true);
  }

  // ── PHASE 2: ONE batched fresh ownership recheck for every candidate. No N+1. ─────────────
  // This is independent of the scan's own lookup: it is asked again, now, immediately before the
  // destructive phase, and it is what catches an upload that confirmed in between.
  let freshOwnership: ReadonlyMap<string, FreshOwnership>;
  try {
    const result = await lookupOwnership(
      options.db,
      candidates.map((c) => c.key),
    );
    const map = new Map<string, FreshOwnership>();
    for (const [key, verdict] of result.verdicts) {
      map.set(
        key,
        verdict.state === 'owned'
          ? { state: 'owned', via: verdict.via }
          : verdict.state === 'unowned'
            ? { state: 'unowned' }
            : { state: 'undetermined', detail: verdict.detail },
      );
    }
    freshOwnership = map;
  } catch (error) {
    // ABORT GATE 2: a failed recheck makes the WHOLE candidate set uncertain, so the destructive
    // phase is abandoned entirely rather than proceeding with a subset.
    const message = error instanceof Error ? error.message : String(error);
    const reason = `The fresh ownership recheck failed (${message}). A database outage is not evidence that no rows exist.`;
    errors.push({ stage: 'db-recheck', message });
    emit({ type: 'cleanup.aborted', cleanupId, reason });
    for (const c of candidates) records.push(skipRecord(c, 'UNDETERMINED', reason));
    return finish(true, reason, false);
  }

  /**
   * ── PHASE 3: VERIFY EVERY CANDIDATE FIRST, delete only afterwards. ────────────────────────
   *
   * Verification and deletion are two separate passes on purpose. Interleaving them means the
   * first object is destroyed before anything is known about the rest, so no honest "N objects
   * are about to be deleted" statement can be made — the operator would only learn the true
   * number after the fact. Verifying the whole set first makes the destructive announcement
   * exact, and it keeps a read-only phase and a write phase cleanly separated.
   */
  let revalidationComplete = true;
  const at = now();
  /** Guards against a duplicate candidate producing two delete attempts for one key. */
  const attempted = new Set<string>();
  /** Verified candidates, paired with the record fields already gathered for them. */
  const toDelete: { verified: VerifiedOrphan; base: Omit<CleanupObjectRecord, 'action'> }[] = [];

  for (const candidate of candidates) {
    if (attempted.has(candidate.key)) continue;
    attempted.add(candidate.key);

    const outcome = await verifyCandidate({
      candidate,
      ownership: freshOwnership.get(candidate.key) ?? {
        state: 'undetermined',
        detail: 'candidate missing from the recheck result',
      },
      reader: options.reader,
      scope: options.scope,
      now: at,
      minAgeMs,
      ...(options.clockSkewAllowanceMs === undefined
        ? {}
        : { clockSkewAllowanceMs: options.clockSkewAllowanceMs }),
    });
    emit({
      type: 'cleanup.revalidated',
      cleanupId,
      key: candidate.key,
      classification: outcome.classification,
    });

    if (outcome.classification === 'R2_ERROR' || outcome.classification === 'UNDETERMINED') {
      revalidationComplete = false;
      errors.push({
        stage: outcome.classification === 'R2_ERROR' ? 'r2-recheck' : 'db-recheck',
        message: outcome.error ?? outcome.reason,
        key: candidate.key,
      });
    }

    const base = {
      key: candidate.key,
      uploadKey: candidate.uploadKey,
      initialClassification: candidate.classification,
      revalidatedClassification: outcome.classification,
      initialSize: candidate.sizeBytes,
      finalSize: outcome.fresh?.sizeBytes ?? null,
      initialETag: candidate.etag,
      finalETag: outcome.fresh?.etag ?? null,
      initialLastModified: candidate.lastModified,
      finalLastModified: outcome.fresh?.lastModified ?? null,
      reason: outcome.reason,
      error: outcome.error ?? null,
    };

    // Anything that is not a minted proof is skipped. `outcome.verified` is the ONLY way past.
    if (outcome.verified === undefined) {
      emit({ type: 'cleanup.skipped', cleanupId, key: candidate.key, reason: outcome.reason });
      records.push({ ...base, action: 'SKIPPED' });
      continue;
    }

    // ── DRY RUN: the executor has no deleter FIELD in this branch, so there is nothing to
    // call even if someone tried. The candidate is recorded as PLANNED and never queued.
    if (options.executor.mode === 'dry-run') {
      records.push({ ...base, action: 'PLANNED' });
      continue;
    }

    toDelete.push({ verified: outcome.verified, base });
  }

  // ── PHASE 4: announce, then delete. Only reachable in execute mode. ───────────────────────
  if (options.executor.mode === 'execute') {
    options.onPreDelete?.({
      cleanupId,
      scopeKind: options.scope.kind,
      prefix: options.scope.prefix,
      bucketWide: options.scope.bucketWide,
      minAgeHours: minAgeMs / 3600000,
      scannedObjects: scan.scanned,
      candidatesFound: scan.orphanCandidates,
      verifiedCandidates: toDelete.length,
      aboutToDelete: toDelete.length,
      protectedCount: candidates.length - toDelete.length,
    });

    for (const { verified, base } of toDelete) {
      // ── exact-key deletion, with proof. ──────────────────────────────────────────────────
      try {
        await options.executor.deleter.deleteVerified(verified);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'cleanup.delete_failed', cleanupId, key: verified.key, error: message });
        errors.push({ stage: 'delete', message, key: verified.key });
        records.push({ ...base, action: 'DELETE_FAILED', error: message });
        continue; // a failed delete never changes how a different candidate is treated
      }

      // ── POST-DELETE VERIFICATION: a non-throwing delete is not proof. ────────────────────
      try {
        const stillThere = await options.reader.headObject(verified.key);
        if (stillThere !== null) {
          emit({
            type: 'cleanup.delete_failed',
            cleanupId,
            key: verified.key,
            error: 'object still present after delete',
          });
          errors.push({
            stage: 'verify',
            message: 'object still readable after a successful delete response',
            key: verified.key,
          });
          records.push({
            ...base,
            action: 'DELETE_VERIFICATION_FAILED',
            reason: `${base.reason} Delete returned success but the object is still readable.`,
          });
          continue;
        }
      } catch (error) {
        // Could not confirm removal. Reported honestly rather than assumed — and NOT retried.
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ stage: 'verify', message, key: verified.key });
        records.push({
          ...base,
          action: 'DELETE_VERIFICATION_FAILED',
          reason: `${base.reason} Delete returned success but removal could not be confirmed.`,
          error: message,
        });
        continue;
      }

      emit({
        type: 'cleanup.deleted',
        cleanupId,
        key: verified.key,
        bytes: verified.sizeBytes ?? 0,
      });
      records.push({ ...base, action: 'DELETED' });
    }
  }

  return finish(false, null, revalidationComplete);
}

function skipRecord(
  candidate: ClassifiedObject,
  classification: RevalidatedClassification,
  reason: string,
): CleanupObjectRecord {
  return {
    key: candidate.key,
    uploadKey: candidate.uploadKey,
    initialClassification: candidate.classification,
    revalidatedClassification: classification,
    initialSize: candidate.sizeBytes,
    finalSize: null,
    initialETag: candidate.etag,
    finalETag: null,
    initialLastModified: candidate.lastModified,
    finalLastModified: null,
    action: 'SKIPPED',
    reason,
    error: null,
  };
}
