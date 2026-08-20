/**
 * PREVIEW-PDF RECLAMATION — vocabulary, proof type, and deletion boundary.
 *
 * This mirrors the raw-upload cleanup's design deliberately and exactly: a `unique symbol` brand
 * declared here and exported nowhere, minted by exactly one function after every fresh gate has
 * passed, with a deleter whose parameter type IS the authorisation. Same safety model, same
 * destructive floor, different object class and different ownership authority.
 *
 * WHY A SECOND PROOF TYPE RATHER THAN REUSING `VerifiedOrphan`. A raw-upload orphan proves
 * "no `photos` row claims this key". A preview-PDF orphan proves something else entirely — "no
 * `album_pdfs` row names this key AND the album itself is gone". Sharing one branded type would
 * let a proof gathered under one rule authorise a deletion under the other. Two brands make that
 * category error unrepresentable.
 */

import { ORPHAN_MIN_AGE_MS } from '../orphan-scan/index.js';

/**
 * THE DESTRUCTIVE FLOOR — derived from the raw path's floor, never re-declared as a second number.
 * Raising the grace period in one place raises it here too.
 */
export const MIN_DESTRUCTIVE_AGE_MS = ORPHAN_MIN_AGE_MS;

/** Initial classification from the scan pass. */
export type PreviewClassification =
  /** A valid preview-PDF key with no owner and past the grace period. The only candidate state. */
  | 'ORPHAN_CANDIDATE'
  /** An `album_pdfs` row names this exact key. */
  | 'OWNED'
  /** Unowned, but the album still exists — a render may be in flight (r2_key is null mid-render). */
  | 'ALBUM_STILL_EXISTS'
  /** Unowned and album-less, but younger than the grace period. */
  | 'RECENT_UNCONFIRMED'
  /** Carried no usable timestamp. */
  | 'UNKNOWN_AGE'
  /** Dated in the future beyond tolerable skew. */
  | 'CLOCK_SKEW_PROTECTED'
  /** Not a preview PDF (raw upload, derivative, admin asset, …). */
  | 'NOT_A_PREVIEW_PDF'
  /** Inside an album namespace but structurally unreadable. */
  | 'MALFORMED'
  /** The ownership lookup failed. Absence of an answer is never absence of an owner. */
  | 'UNDETERMINED';

/** Terminal state after fresh revalidation, immediately before any deletion. */
export type RevalidatedPreviewClassification =
  /** Passed every fresh gate. The ONLY deletable state. */
  | 'VERIFIED_ORPHAN'
  /** An `album_pdfs` row claimed the key between scan and now. */
  | 'OWNED_AT_RECHECK'
  /** The album exists again / still — never delete a live album's PDF. */
  | 'ALBUM_EXISTS_AT_RECHECK'
  /** No longer in R2 — already cleaned up by another path. */
  | 'MISSING_AT_RECHECK'
  /** Size, ETag or LastModified moved since the scan. */
  | 'CHANGED_SINCE_SCAN'
  /** Fresh metadata put it back inside the grace period. */
  | 'RECENT_AT_RECHECK'
  | 'UNKNOWN_AGE'
  | 'CLOCK_SKEW_PROTECTED'
  | 'UNDETERMINED'
  | 'R2_ERROR'
  | 'NOT_A_CANDIDATE';

/** Every refusal state, derived so a new state cannot silently become deletable. */
export const NON_DELETABLE_PREVIEW_STATES: readonly RevalidatedPreviewClassification[] = [
  'OWNED_AT_RECHECK',
  'ALBUM_EXISTS_AT_RECHECK',
  'MISSING_AT_RECHECK',
  'CHANGED_SINCE_SCAN',
  'RECENT_AT_RECHECK',
  'UNKNOWN_AGE',
  'CLOCK_SKEW_PROTECTED',
  'UNDETERMINED',
  'R2_ERROR',
  'NOT_A_CANDIDATE',
];

export type PreviewCleanupAction =
  | 'PLANNED'
  | 'DELETED'
  | 'DELETE_FAILED'
  | 'DELETE_VERIFICATION_FAILED'
  | 'SKIPPED';

/** THE BRAND. Declared here, exported nowhere. Only `verifyPreviewCandidate` can attach it. */
declare const VERIFIED_PREVIEW_ORPHAN_BRAND: unique symbol;

/** PROOF THAT ONE EXACT PREVIEW-PDF KEY MAY BE DELETED. */
export interface VerifiedPreviewOrphan {
  readonly [VERIFIED_PREVIEW_ORPHAN_BRAND]: true;
  /** The exact key to delete — never a prefix, never a pattern. */
  readonly key: string;
  readonly userId: string;
  readonly albumId: string;
  /** Evidence: no `album_pdfs` row named this key at verification time. */
  readonly noPdfRowReferencing: true;
  /** Evidence: the owning album did not exist at verification time. */
  readonly albumAbsent: true;
  /** Metadata read FRESH during revalidation and matched against the scan. */
  readonly sizeBytes: number | null;
  readonly etag: string | null;
  readonly lastModified: string;
  readonly ageMs: number;
}

/** The internal brand key, for `verify.ts` only. Not re-exported by the barrel. */
export const PREVIEW_BRAND: typeof VERIFIED_PREVIEW_ORPHAN_BRAND = Symbol(
  'verified-preview-orphan',
) as unknown as typeof VERIFIED_PREVIEW_ORPHAN_BRAND;

/** One candidate's full journey, for the report. */
export interface PreviewObjectRecord {
  readonly key: string;
  readonly userId: string | null;
  readonly albumId: string | null;
  readonly initialClassification: PreviewClassification;
  readonly revalidatedClassification: RevalidatedPreviewClassification | null;
  readonly sizeBytes: number | null;
  readonly lastModified: string | null;
  readonly ageMs: number | null;
  readonly action: PreviewCleanupAction | null;
  readonly reason: string;
  readonly error: string | null;
}

export interface PreviewCleanupReport {
  readonly runId: string;
  readonly generatedAt: string;
  readonly durationMs: number;
  readonly mode: 'dry-run' | 'execute';
  readonly minAgeHours: number;
  readonly scanComplete: boolean;
  readonly revalidationComplete: boolean;
  readonly aborted: boolean;
  readonly abortReason: string | null;

  readonly scannedObjects: number;
  readonly previewPdfsSeen: number;
  readonly owned: number;
  readonly albumStillExists: number;
  readonly recentUnconfirmed: number;
  readonly unknownAge: number;
  readonly clockSkewProtected: number;
  readonly malformed: number;
  readonly undetermined: number;
  readonly candidates: number;

  readonly verifiedCandidates: number;
  readonly ownedAtRecheck: number;
  readonly albumExistsAtRecheck: number;
  readonly missingAtRecheck: number;
  readonly changedSinceScan: number;
  readonly recentAtRecheck: number;
  readonly r2Errors: number;

  readonly deleteAttempted: number;
  readonly deleted: number;
  readonly deleteFailed: number;
  readonly deleteVerificationFailed: number;
  readonly skipped: number;
  readonly bytesReclaimed: number;

  readonly errors: readonly { readonly stage: string; readonly message: string; readonly key?: string }[];
  readonly objects: readonly PreviewObjectRecord[];
}
