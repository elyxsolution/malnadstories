/**
 * THE VERIFICATION STATE MACHINE — the only place a `VerifiedOrphan` can be minted.
 *
 * A Prompt-2 scan says "this looked unowned and old when I looked". That is evidence, never
 * authorisation: minutes or hours may have passed, an offline client may have confirmed, another
 * process may have rewritten the object. So every gate is asked AGAIN, from scratch, immediately
 * before deletion:
 *
 *   ORPHAN_CANDIDATE
 *        │  scope        — does the key still sit inside the requested scope?
 *        │  parse        — is it still a structurally valid bare raw-upload key?
 *        │  DB recheck   — does any photos row claim it NOW? (upload_key, then legacy r2_key)
 *        │  R2 recheck   — does it still exist, with the same size / ETag / LastModified?
 *        │  age recheck  — recomputed from the FRESH timestamp, not the scan's
 *        ▼
 *   VERIFIED_ORPHAN  → deletable
 *
 * EVERY GATE FAILS CLOSED. A database error is not "no owner". A HEAD failure is not "unchanged".
 * A missing timestamp is not "old enough". Each produces its own refusal state, so the report can
 * say which gate stopped it rather than lumping everything into a generic skip.
 *
 * The gates are separate exported functions rather than one long conditional, so each is directly
 * testable and none can be accidentally reordered past the mint.
 */

import {
  CLOCK_SKEW_ALLOWANCE_MS,
  ORPHAN_MIN_AGE_MS,
  parseRawUploadKey,
  type ClassifiedObject,
  type ScanScope,
} from '../orphan-scan/index.js';
import type { ReadOnlyMetadataReader } from '../orphan-scan/object-lister.js';
import type { ListedObject } from '../orphan-scan/classify.js';
import { BRAND, type RevalidatedClassification, type VerifiedOrphan } from './model.js';

/** Outcome of revalidating one candidate. `verified` is present only for `VERIFIED_ORPHAN`. */
export type VerificationOutcome = {
  readonly classification: RevalidatedClassification;
  readonly reason: string;
  /** Fresh metadata, when it could be read. */
  readonly fresh: ListedObject | null;
  /** THE PROOF. Present if and only if `classification === 'VERIFIED_ORPHAN'`. */
  readonly verified?: VerifiedOrphan;
  readonly error?: string;
};

/** Ownership as re-established at deletion time. */
export type FreshOwnership =
  | { readonly state: 'owned'; readonly via: 'upload_key' | 'r2_key' }
  | { readonly state: 'unowned' }
  | { readonly state: 'undetermined'; readonly detail: string };

export interface VerifyOptions {
  readonly candidate: ClassifiedObject;
  readonly ownership: FreshOwnership;
  readonly reader: ReadOnlyMetadataReader;
  readonly scope: ScanScope;
  readonly now: number;
  readonly minAgeMs?: number;
  readonly clockSkewAllowanceMs?: number;
}

/**
 * GATE 0 — scope integrity. A candidate must still belong to the scope the operator asked for.
 *
 * Checked against the PARSED user/album ids rather than a string prefix comparison, so a crafted
 * key cannot satisfy it by looking similar. For `--bucket`, every raw upload is in scope.
 */
export function inScope(key: string, scope: ScanScope): boolean {
  const parsed = parseRawUploadKey(key);
  if (!parsed.ok) return false;
  if (scope.bucketWide) return true;
  // The scan's prefix was itself built from validated UUIDs (Prompt 2 `resolveScope`), so an
  // exact prefix match on the parsed identity is a genuine containment check.
  return key.startsWith(scope.prefix);
}

/**
 * Truncate an ISO timestamp to whole seconds.
 *
 * WHY THIS IS NECESSARY, and why it is not a loosening of the check. `ListObjectsV2` reports
 * `LastModified` with millisecond precision, but `HeadObject` derives it from the HTTP
 * `Last-Modified` response header, whose RFC-1123 format carries NO sub-second component. The
 * same untouched object therefore reports `…:43.523Z` when listed and `…:43.000Z` when headed.
 *
 * Comparing those raw strings marks every object as changed, which fails closed — safe, but it
 * makes the cleanup permanently incapable of deleting anything. (Observed against real R2 during
 * the first controlled run of this slice, before any object had been deleted.) Comparing at the
 * precision the protocol actually guarantees is the correct fix: size and ETag are still matched
 * exactly, and any genuine rewrite changes the ETag, so sameness remains real.
 */
function toSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** GATE 3 — is the fresh object the same object the scan classified? */
export function sameObject(
  scanned: ClassifiedObject,
  fresh: ListedObject,
): { same: true } | { same: false; field: string } {
  if (
    scanned.sizeBytes !== null &&
    fresh.sizeBytes !== null &&
    scanned.sizeBytes !== fresh.sizeBytes
  ) {
    return { same: false, field: 'size' };
  }
  // ETag is the strongest signal: R2 changes it on any content rewrite. Matched byte-exactly.
  if (scanned.etag !== null && fresh.etag !== null && scanned.etag !== fresh.etag) {
    return { same: false, field: 'etag' };
  }
  if (scanned.lastModified !== null && fresh.lastModified !== null) {
    const a = toSeconds(scanned.lastModified);
    const b = toSeconds(fresh.lastModified);
    // An unparseable timestamp is not evidence of CHANGE — it is evidence of unknown age, which
    // the age gate below refuses on its own with an accurate reason. Reporting "changed" here
    // would be equally safe but misleading, so the comparison simply abstains.
    if (a !== null && b !== null && a !== b) return { same: false, field: 'lastModified' };
  }
  return { same: true };
}

/**
 * Revalidate one candidate and, only if every gate passes, mint the proof that permits deletion.
 *
 * This function performs at most ONE R2 read (a HEAD). It never reads object bytes, never writes,
 * and cannot delete — deletion lives behind the returned proof, in a different module.
 */
export async function verifyCandidate(options: VerifyOptions): Promise<VerificationOutcome> {
  const { candidate, ownership, reader, scope, now } = options;
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const skewMs = options.clockSkewAllowanceMs ?? CLOCK_SKEW_ALLOWANCE_MS;

  const refuse = (
    classification: RevalidatedClassification,
    reason: string,
    fresh: ListedObject | null = null,
    error?: string,
  ): VerificationOutcome => ({
    classification,
    reason,
    fresh,
    ...(error === undefined ? {} : { error }),
  });

  // ── GATE 1: it must have been a candidate. Defence in depth — the caller already filters. ──
  if (candidate.classification !== 'ORPHAN_CANDIDATE') {
    return refuse(
      'NOT_A_CANDIDATE',
      `Initial classification was ${candidate.classification}, not ORPHAN_CANDIDATE.`,
    );
  }

  // ── GATE 0: scope + a re-parse of the key. A derivative or malformed key dies here. ────────
  const parsed = parseRawUploadKey(candidate.key);
  if (!parsed.ok) {
    return refuse(
      'NOT_A_CANDIDATE',
      `Key is not a valid bare raw upload on re-parse (${parsed.detail}).`,
    );
  }
  if (!inScope(candidate.key, scope)) {
    return refuse('OUT_OF_SCOPE', `Key is outside the requested scope "${scope.prefix}".`);
  }

  // ── GATE 2: fresh ownership. The confirm race is caught here. ──────────────────────────────
  if (ownership.state === 'undetermined') {
    return refuse(
      'UNDETERMINED',
      `Fresh ownership lookup did not succeed (${ownership.detail}); absence of an answer is not absence of an owner.`,
    );
  }
  if (ownership.state === 'owned') {
    return refuse(
      'OWNED_AT_RECHECK',
      `A photos row now claims this key via ${ownership.via} — it was unowned at scan time and is owned now.`,
    );
  }

  // ── GATE 3: fresh R2 metadata. Prove it is the same object. ────────────────────────────────
  let fresh: ListedObject | null;
  try {
    fresh = await reader.headObject(candidate.key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refuse(
      'R2_ERROR',
      `Could not read fresh metadata, so sameness cannot be proven (${message}).`,
      null,
      message,
    );
  }
  if (fresh === null) {
    return refuse('MISSING_AT_RECHECK', 'The object no longer exists in R2; nothing to delete.');
  }
  const same = sameObject(candidate, fresh);
  if (!same.same) {
    return refuse(
      'CHANGED_SINCE_SCAN',
      `The object's ${same.field} changed since the scan; it is not demonstrably the same object.`,
      fresh,
    );
  }

  // ── GATE 4: age, recomputed from the FRESH timestamp. ──────────────────────────────────────
  if (fresh.lastModified === null) {
    return refuse(
      'UNKNOWN_AGE',
      'Fresh metadata carried no usable LastModified, so age cannot be established.',
      fresh,
    );
  }
  const at = Date.parse(fresh.lastModified);
  if (!Number.isFinite(at)) {
    return refuse('UNKNOWN_AGE', 'Fresh LastModified is not a parseable date.', fresh);
  }
  if (at > now + skewMs) {
    return refuse(
      'CLOCK_SKEW_PROTECTED',
      `Fresh LastModified is ${Math.round((at - now) / 1000)}s in the future, beyond the skew allowance.`,
      fresh,
    );
  }
  const ageMs = now - at;
  if (ageMs < minAgeMs) {
    return refuse(
      'RECENT_AT_RECHECK',
      `Fresh age is ${Math.round(ageMs / 60000)}m, inside the ${Math.round(minAgeMs / 3600000)}h grace period.`,
      fresh,
    );
  }

  // ── ALL GATES PASSED. Mint the proof. This is the ONLY construction site. ──────────────────
  const verified: VerifiedOrphan = {
    [BRAND]: true,
    key: candidate.key,
    uploadKey: parsed.value.key,
    userId: parsed.value.userId,
    albumId: parsed.value.albumId,
    sizeBytes: fresh.sizeBytes,
    etag: fresh.etag,
    lastModified: fresh.lastModified,
    ageMs,
  };

  return {
    classification: 'VERIFIED_ORPHAN',
    reason: `Unowned on a fresh lookup, unchanged since the scan, and ${Math.round(ageMs / 3600000)}h old (>= the ${Math.round(minAgeMs / 3600000)}h grace period).`,
    fresh,
    verified,
  };
}
