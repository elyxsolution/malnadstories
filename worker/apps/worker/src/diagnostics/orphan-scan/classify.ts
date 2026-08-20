/**
 * THE CLASSIFICATION STATE MACHINE — pure, total, and deliberately biased toward protection.
 *
 * One function decides what every object is, from three inputs: its key, its listing metadata, and
 * whether the database claims it. No I/O, no clock of its own (`now` is injected), no hidden state
 * — so every branch below is directly testable, which is the point.
 *
 * THE RACE THIS TOLERATES. The R2 listing and the database lookup happen at slightly different
 * instants, so "absent from the DB at the moment I asked" is NOT proof of permanent orphanhood: a
 * confirm could have landed a millisecond later, and an offline client could confirm hours later.
 * The grace period is the entire answer to that race — it is why an unowned object is only ever
 * called a candidate once it is older than any plausible in-flight upload.
 */

import {
  CLOCK_SKEW_ALLOWANCE_MS,
  ORPHAN_MIN_AGE_MS,
  type ClassifiedObject,
  type OrphanClassification,
} from './model.js';
import { isInAlbumNamespace, parseRawUploadKey } from './raw-upload-key.js';

/** The listing metadata one object contributes. Mirrors what `ListObjectsV2` returns. */
export interface ListedObject {
  readonly key: string;
  readonly sizeBytes: number | null;
  /** ISO-8601 string, or `null`/invalid when the backend gave nothing trustworthy. */
  readonly lastModified: string | null;
  readonly etag: string | null;
}

/** What the database said about a key. `undetermined` when the lookup itself failed. */
export type OwnershipVerdict =
  | {
      readonly state: 'owned';
      readonly via: 'upload_key' | 'r2_key';
      readonly duplicateRows?: number;
    }
  | { readonly state: 'unowned' }
  | { readonly state: 'undetermined'; readonly detail: string };

export interface ClassifyInput {
  readonly object: ListedObject;
  readonly ownership: OwnershipVerdict;
  /** Injected clock — never `Date.now()` inside, so boundary behaviour is deterministic in tests. */
  readonly now: number;
  readonly minAgeMs?: number;
  readonly clockSkewAllowanceMs?: number;
}

/**
 * Parse a listing timestamp defensively. Anything that is not a finite, real date is treated as
 * absent — a `NaN` age must never silently compare as "old enough".
 */
function parseTimestamp(value: string | null): number | null {
  if (value === null || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function classifyObject(input: ClassifyInput): ClassifiedObject {
  const { object, ownership, now } = input;
  const minAgeMs = input.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const skewMs = input.clockSkewAllowanceMs ?? CLOCK_SKEW_ALLOWANCE_MS;

  const parsed = parseRawUploadKey(object.key);
  const at = parseTimestamp(object.lastModified);
  const ageMs = at === null ? null : now - at;

  const base = {
    key: object.key,
    sizeBytes: object.sizeBytes,
    lastModified: object.lastModified,
    etag: object.etag,
    ageMs,
  };
  const done = (
    classification: OrphanClassification,
    reason: string,
    uploadKey: string | null,
  ): ClassifiedObject => ({ ...base, uploadKey, classification, reason });

  // ── 1. Is this a raw upload at all? ───────────────────────────────────────────────────────
  if (!parsed.ok) {
    // Inside a real album namespace but unreadable ⇒ MALFORMED, which is protected and surfaced.
    // Recognised other classes (derivatives, the PDF) and everything outside the namespace are
    // simply not candidates, so they can never reach an age or ownership test.
    if (
      parsed.rejection === 'malformed' ||
      (parsed.rejection !== 'other-object-class' && isInAlbumNamespace(object.key))
    ) {
      return done(
        'MALFORMED_KEY',
        `In an album namespace but not a valid raw upload: ${parsed.detail}.`,
        null,
      );
    }
    return done('NOT_RAW_UPLOAD', `Not a raw upload (${parsed.detail}).`, null);
  }

  // From here the key IS the upload identity — the presign route writes it verbatim into
  // `photos.upload_key`, so no separate identity mapping exists or is needed.
  const uploadKey = parsed.value.key;

  // ── 2. Could we establish ownership? ──────────────────────────────────────────────────────
  if (ownership.state === 'undetermined') {
    return done(
      'UNDETERMINED',
      `Ownership could not be established: ${ownership.detail}.`,
      uploadKey,
    );
  }

  if (ownership.state === 'owned') {
    const dup =
      ownership.duplicateRows !== undefined && ownership.duplicateRows > 1
        ? ` (WARNING: ${ownership.duplicateRows} photo rows claim this key)`
        : '';
    return done('OWNED', `A photos row claims this key via ${ownership.via}${dup}.`, uploadKey);
  }

  // ── 3. Unowned. Now age decides, and every unusable age protects. ─────────────────────────
  if (at === null || ageMs === null) {
    return done(
      'UNKNOWN_AGE',
      'No photos row claims this key, but the storage backend reported no usable LastModified, so its age cannot be established.',
      uploadKey,
    );
  }

  if (at > now + skewMs) {
    return done(
      'CLOCK_SKEW_PROTECTED',
      `No photos row claims this key, but it is dated ${Math.round((at - now) / 1000)}s in the future (beyond the ${Math.round(skewMs / 60000)}m skew allowance), so its age is not trustworthy.`,
      uploadKey,
    );
  }

  // DETERMINISTIC BOUNDARY: `>=` — an object at exactly the threshold is a candidate. Stated
  // explicitly because "24 hours old" must mean one thing, and it is asserted in the tests.
  if (ageMs >= minAgeMs) {
    return done(
      'ORPHAN_CANDIDATE',
      `No photos row claims this key and it is ${Math.round(ageMs / 3600000)}h old (>= the ${Math.round(minAgeMs / 3600000)}h grace period). Worth investigating — NOT proven safe to delete.`,
      uploadKey,
    );
  }

  return done(
    'RECENT_UNCONFIRMED',
    `No photos row claims this key yet, but it is only ${Math.round(ageMs / 60000)}m old (< the ${Math.round(minAgeMs / 3600000)}h grace period); its confirm may still be in flight.`,
    uploadKey,
  );
}
