/**
 * R2 ORPHAN DETECTION — the vocabulary and the safety thresholds.
 *
 * THIS SLICE IS REPORT-ONLY. Nothing in this directory deletes, writes, overwrites, or enqueues
 * anything. There is deliberately no deletion function anywhere — not even one behind a flag —
 * because a dry-run switch around a delete is one typo away from a destroyed photograph. The
 * output of this subsystem is a report; acting on it belongs to a later, separately-reviewed slice.
 *
 * THE CENTRAL ASYMMETRY, which every default here is chosen from: a false negative costs a few
 * kilobytes of storage for a while longer. A false positive, once a future phase acts on it,
 * destroys a customer's photograph — the browser released the `File` at confirm, so R2 holds the
 * only copy. Every ambiguous case therefore resolves to PROTECTED, never to candidate.
 */

/**
 * Terminal classification for one R2 object.
 *
 * Exactly ONE of these is `ORPHAN_CANDIDATE`. Everything else is either owned, out of scope, or
 * explicitly protected — and each protection records WHY, so an operator reading the report can
 * tell "we know this is fine" apart from "we could not tell".
 */
export type OrphanClassification =
  /** A `photos` row claims this exact key. Definitively in use. */
  | 'OWNED'
  /** Not a raw upload at all (a derivative, the album PDF, or an admin namespace). Not a candidate. */
  | 'NOT_RAW_UPLOAD'
  /** Inside the album namespace but the key does not match the raw-upload contract. PROTECTED. */
  | 'MALFORMED_KEY'
  /** Unowned, but younger than the grace period — confirm may still be in flight. PROTECTED. */
  | 'RECENT_UNCONFIRMED'
  /** Unowned, but the storage backend gave no usable timestamp, so age is unknowable. PROTECTED. */
  | 'UNKNOWN_AGE'
  /** Unowned, but dated in the future beyond tolerable clock skew. PROTECTED. */
  | 'CLOCK_SKEW_PROTECTED'
  /** Ownership could not be established because a lookup failed. PROTECTED. */
  | 'UNDETERMINED'
  /** Unowned, age known and beyond the grace period. WORTH INVESTIGATING — not "safe to delete". */
  | 'ORPHAN_CANDIDATE';

/**
 * Classifications that a future cleanup phase must never touch. `ORPHAN_CANDIDATE` is deliberately
 * absent, and `OWNED`/`NOT_RAW_UPLOAD` are absent because they are not candidates in the first place.
 * Exported so a later slice can assert against this list rather than re-deriving the rule.
 */
export const PROTECTED_CLASSIFICATIONS: readonly OrphanClassification[] = [
  'MALFORMED_KEY',
  'RECENT_UNCONFIRMED',
  'UNKNOWN_AGE',
  'CLOCK_SKEW_PROTECTED',
  'UNDETERMINED',
];

/**
 * THE GRACE PERIOD — 24 hours by default.
 *
 * The window that must be survived is R2-PUT-complete → confirm-success, and its dominant term is
 * not network latency: Phase 6 Prompt 1 added offline suspension, so a device that completed a PUT
 * and then lost connectivity holds an unconfirmed object for as long as the tab stays alive. A
 * backgrounded/frozen tab can resume hours later. 24 hours is the floor that makes those cases
 * uninteresting; the value is configurable upward and never downward in practice.
 */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Tolerance for a `LastModified` in the future. Object stores and application servers do not share
 * a clock; a few minutes of skew is ordinary. Beyond this the timestamp is not trustworthy at all,
 * so the object is protected rather than reasoned about.
 */
export const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000;

/** Objects examined per listing page. R2/S3 caps `ListObjectsV2` at 1000. */
export const LIST_PAGE_SIZE = 1000;

/**
 * Upper bound on unique keys sent to one `upload_key = any($1)` lookup. Keeps the parameter array
 * and the returned row set bounded regardless of how large a listing page is.
 */
export const DB_LOOKUP_BATCH_SIZE = 500;

/** A hard ceiling on pages, so a pathological listing can never loop forever. */
export const MAX_LIST_PAGES = 10_000;

/** Where the classification decision came from. Included per object so the report is self-explaining. */
export interface ClassifiedObject {
  /** The full R2 object key. */
  readonly key: string;
  /**
   * The upload identity this object represents — which, by the presign contract, IS the key itself.
   * `null` when the key is not a parseable raw upload.
   */
  readonly uploadKey: string | null;
  readonly sizeBytes: number | null;
  /** ISO-8601, or `null` when the backend reported none. */
  readonly lastModified: string | null;
  /** Diagnostic only — never used for ownership. */
  readonly etag: string | null;
  readonly classification: OrphanClassification;
  /** Human-readable justification. Written for an operator, not for a parser. */
  readonly reason: string;
  /** Object age in ms at scan time, when it could be computed. */
  readonly ageMs: number | null;
}

/** A problem encountered mid-scan. Its presence forces `scanComplete: false`. */
export interface ScanError {
  readonly stage: 'list' | 'db-lookup' | 'scope' | 'config';
  readonly message: string;
  /** The listing page (1-based) the failure occurred on, when applicable. */
  readonly page?: number;
}

/** A database state that should be impossible. Reported, never silently resolved. */
export interface DbInconsistency {
  readonly kind: 'duplicate-upload-key';
  readonly uploadKey: string;
  readonly rowCount: number;
}

/** What the scan was asked to look at. Recorded verbatim so a report is reproducible. */
export interface ScanScope {
  readonly kind: 'album' | 'user' | 'bucket';
  /** The literal R2 prefix listed. Empty string for a bucket-wide scan. */
  readonly prefix: string;
  /** True only for the explicitly opted-in whole-bucket scan. Surfaced prominently in the report. */
  readonly bucketWide: boolean;
}

export interface OrphanScanReport {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly durationMs: number;
  readonly scope: ScanScope;
  readonly minAgeHours: number;
  readonly clockSkewAllowanceMinutes: number;

  /**
   * FALSE whenever ANY page or lookup failed. A partial scan reporting zero orphan candidates
   * means "we did not finish looking", never "there is nothing there" — so this flag must be
   * checked before any number below is believed.
   */
  readonly scanComplete: boolean;

  /** Total objects returned by the listing, before any filtering. */
  readonly scanned: number;
  /** Objects returned more than once by the listing (deduped before classification). */
  readonly duplicateListingEntries: number;
  /** Objects inside the raw-upload namespace — i.e. everything except `NOT_RAW_UPLOAD`. */
  readonly candidates: number;

  readonly owned: number;
  readonly notRawUpload: number;
  readonly malformed: number;
  readonly recentUnconfirmed: number;
  readonly unknownAge: number;
  readonly clockSkewProtected: number;
  readonly undetermined: number;
  readonly orphanCandidates: number;

  /**
   * The §9 "UNKNOWN_KEY" bucket, exposed as a DERIVED rollup rather than a ninth terminal state:
   * every object that parsed as a raw upload but has no `photos` owner. It is exactly
   * `recentUnconfirmed + unknownAge + clockSkewProtected + orphanCandidates`. Keeping the terminal
   * states separate is what lets the report say *why* each unowned object is protected.
   */
  readonly unknownKey: number;

  readonly pagesListed: number;
  readonly dbLookups: number;
  readonly errors: readonly ScanError[];
  readonly dbInconsistencies: readonly DbInconsistency[];
  /** Every classified object, sorted by key for deterministic output. */
  readonly objects: readonly ClassifiedObject[];
}
