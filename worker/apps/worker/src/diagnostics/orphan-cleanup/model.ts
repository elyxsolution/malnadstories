/**
 * SAFE ORPHAN RECLAMATION — the vocabulary, the proof type, and the deletion boundary.
 *
 * Phase 6 Prompt 2 built a detector that could not delete. This slice adds deletion — and the
 * entire design question is how to add it without also adding a way to delete the wrong thing.
 *
 * THE ANSWER IS A PROOF-CARRYING TYPE. `VerifiedOrphan` carries a `unique symbol` brand that is
 * declared in this module and NEVER exported. The only function that can mint one is
 * `verifyCandidate` in `verify.ts`, and it only does so after every fresh gate has passed. The
 * deleter's signature is `deleteVerified(orphan: VerifiedOrphan)` — there is no
 * `delete(key: string)` anywhere in the subsystem. So "delete an arbitrary key" is not a rule the
 * code follows; it is a sentence that cannot be written in this type system.
 *
 * A REPORT IS EVIDENCE, NOT AUTHORISATION. A stored Prompt-2 report can suggest a candidate, but
 * it can never authorise a deletion: `verifyCandidate` re-asks the database, re-reads the object's
 * metadata, and re-computes the age at the moment of deletion. Anything stale fails closed.
 */

import { ORPHAN_MIN_AGE_MS, type OrphanClassification } from '../orphan-scan/index.js';

/**
 * THE DESTRUCTIVE FLOOR — the smallest grace period `--execute` will ever accept.
 *
 * Prompt 3 made `--min-age-hours` configurable, which is right for diagnostics: a dry run at 0h is
 * how the pipeline was proved against a purpose-built fixture. But the same knob meant a single
 * mistyped flag could authorise deleting an upload that was seconds old — an upload whose confirm
 * was still in flight, whose bytes R2 is the only copy of.
 *
 * DERIVED, NOT DECLARED. This is `ORPHAN_MIN_AGE_MS` itself, not a second number that could drift
 * away from it. Raising the production grace period automatically raises the destructive floor;
 * there remains exactly one place the 24 hours is written down.
 *
 * Dry run is deliberately NOT subject to this: a dry run deletes nothing, so a 0h diagnostic is
 * both safe and useful. The floor guards the only mode that can destroy something.
 */
export const MIN_DESTRUCTIVE_AGE_MS = ORPHAN_MIN_AGE_MS;

/**
 * Terminal state of one candidate after revalidation.
 *
 * Exactly ONE value — `VERIFIED_ORPHAN` — can lead to deletion. Every other value is a refusal,
 * and each records which gate refused, so a protected object is never indistinguishable from an
 * unexamined one.
 */
export type RevalidatedClassification =
  /** Passed every fresh gate. The ONLY deletable state. */
  | 'VERIFIED_ORPHAN'
  /** A `photos` row claimed the key between the scan and now. The confirm race, caught. */
  | 'OWNED_AT_RECHECK'
  /** The object is no longer in R2 — already cleaned up, or deleted by another path. */
  | 'MISSING_AT_RECHECK'
  /** Size, ETag or LastModified moved since the scan. Not demonstrably the same object. */
  | 'CHANGED_SINCE_SCAN'
  /** Fresh metadata put it back inside the grace period. */
  | 'RECENT_AT_RECHECK'
  /** Fresh metadata carried no usable timestamp. */
  | 'UNKNOWN_AGE'
  /** Fresh metadata is dated in the future beyond tolerable skew. */
  | 'CLOCK_SKEW_PROTECTED'
  /** The scope no longer matches (defence in depth against a mis-scoped candidate). */
  | 'OUT_OF_SCOPE'
  /** The ownership lookup failed. Absence of an answer is never absence of an owner. */
  | 'UNDETERMINED'
  /** The metadata read failed. Could not prove sameness. */
  | 'R2_ERROR'
  /** Never a candidate in the first place (defence in depth — should be unreachable). */
  | 'NOT_A_CANDIDATE';

/** Every refusal state. Deliberately derived so a new state cannot silently become deletable. */
export const NON_DELETABLE_STATES: readonly RevalidatedClassification[] = [
  'OWNED_AT_RECHECK',
  'MISSING_AT_RECHECK',
  'CHANGED_SINCE_SCAN',
  'RECENT_AT_RECHECK',
  'UNKNOWN_AGE',
  'CLOCK_SKEW_PROTECTED',
  'OUT_OF_SCOPE',
  'UNDETERMINED',
  'R2_ERROR',
  'NOT_A_CANDIDATE',
];

/** What actually happened to a candidate. */
export type CleanupAction =
  /** Dry run: verified, and deliberately not deleted. */
  | 'PLANNED'
  | 'DELETED'
  | 'DELETE_FAILED'
  /** The delete call succeeded but the object is still readable afterwards. */
  | 'DELETE_VERIFICATION_FAILED'
  /** A gate refused. No delete was attempted. */
  | 'SKIPPED';

/**
 * THE BRAND. Declared here, exported nowhere. A `VerifiedOrphan` therefore cannot be constructed
 * by any module except `verify.ts`, which imports the symbol from this file — not even by an
 * object literal, because the property key is not nameable outside this module graph.
 */
declare const VERIFIED_ORPHAN_BRAND: unique symbol;

/**
 * PROOF THAT ONE EXACT KEY MAY BE DELETED.
 *
 * Every field is evidence gathered during revalidation, kept so the report can explain the
 * decision after the fact. `key` is the exact object key — never a prefix, never a pattern.
 */
export interface VerifiedOrphan {
  /** Unforgeable brand. See `VERIFIED_ORPHAN_BRAND`. */
  readonly [VERIFIED_ORPHAN_BRAND]: true;
  /** The exact key to delete. */
  readonly key: string;
  /** Identical to `key` — the presign contract writes it verbatim into `photos.upload_key`. */
  readonly uploadKey: string;
  readonly userId: string;
  readonly albumId: string;
  /** Metadata read FRESH during revalidation and matched against the scan. */
  readonly sizeBytes: number | null;
  readonly etag: string | null;
  readonly lastModified: string;
  /** Age in ms, recomputed from the fresh timestamp. */
  readonly ageMs: number;
}

/** The internal brand key, for `verify.ts` only. Not re-exported by the barrel. */
export const BRAND: typeof VERIFIED_ORPHAN_BRAND = Symbol(
  'verified-orphan',
) as unknown as typeof VERIFIED_ORPHAN_BRAND;

/** One candidate's full journey, for the report. */
export interface CleanupObjectRecord {
  readonly key: string;
  readonly uploadKey: string | null;
  readonly initialClassification: OrphanClassification;
  readonly revalidatedClassification: RevalidatedClassification;
  readonly initialSize: number | null;
  readonly finalSize: number | null;
  readonly initialETag: string | null;
  readonly finalETag: string | null;
  readonly initialLastModified: string | null;
  readonly finalLastModified: string | null;
  readonly action: CleanupAction;
  /** Human-readable justification, written for an operator. */
  readonly reason: string;
  readonly error: string | null;
}

export interface CleanupError {
  readonly stage: 'scan' | 'db-recheck' | 'r2-recheck' | 'delete' | 'verify' | 'scope' | 'config';
  readonly message: string;
  readonly key?: string;
}

export interface CleanupReport {
  readonly cleanupId: string;
  /** The scan this cleanup was derived from — traceable back to a Prompt-2 report. */
  readonly scanId: string;
  readonly generatedAt: string;
  readonly durationMs: string | number;
  readonly mode: 'dry-run' | 'execute';
  readonly scope: { readonly kind: string; readonly prefix: string; readonly bucketWide: boolean };
  readonly minAgeHours: number;

  /** From the Prompt-2 scan. FALSE ⇒ the run aborts before any deletion. */
  readonly scanComplete: boolean;
  /** False when any revalidation stage failed; a partial revalidation never reads as clean. */
  readonly revalidationComplete: boolean;
  /** True when the run refused to proceed to the destructive phase at all. */
  readonly aborted: boolean;
  readonly abortReason: string | null;

  readonly scannedObjects: number;
  readonly candidatesFound: number;
  readonly verifiedCandidates: number;

  readonly ownedAtRecheck: number;
  readonly missingAtRecheck: number;
  readonly changedSinceScan: number;
  readonly recentAtRecheck: number;
  readonly unknownAge: number;
  readonly clockSkewProtected: number;
  readonly outOfScope: number;
  readonly undetermined: number;
  readonly r2Errors: number;

  readonly deleteAttempted: number;
  readonly deleted: number;
  readonly deleteFailed: number;
  readonly deleteVerificationFailed: number;
  readonly skipped: number;
  readonly bytesReclaimed: number;

  readonly errors: readonly CleanupError[];
  readonly objects: readonly CleanupObjectRecord[];
}
