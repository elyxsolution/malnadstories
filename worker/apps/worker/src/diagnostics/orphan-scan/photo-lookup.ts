/**
 * OWNERSHIP LOOKUP — "does the database claim this exact R2 object?", answered in BATCHES.
 *
 * NO N+1. The scanner hands over a whole page's worth of unique keys and gets back one map. Each
 * batch is a single `= any($1)` query with a bounded parameter array, so cost is O(pages), not
 * O(objects).
 *
 * AUTHORITY: `photos.upload_key` (0053) is the ownership identity — globally unique where non-null,
 * never nulled by the worker, and written verbatim from the presign key.
 *
 * THE LEGACY SAFETY NET: rows created BEFORE 0053 that had already been hardened have
 * `upload_key = NULL`, and 0053 deliberately did not fabricate one. If such a row's raw object
 * somehow still exists, matching on `upload_key` alone would call it unowned. So `r2_key` is
 * checked too. This can only ever move an object from candidate to OWNED — it makes the detector
 * strictly more conservative, and it adds no new ownership table or migration.
 *
 * READ-ONLY: the only statement in this file is a SELECT.
 */

import { DB_LOOKUP_BATCH_SIZE } from './model.js';
import type { DbInconsistency } from './model.js';
import type { OwnershipVerdict } from './classify.js';

/** The minimal query surface needed. Satisfied by the worker's `DatabaseAdapter`, and by a fake. */
export interface OwnershipQuery {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
}

interface OwnerRow {
  readonly upload_key: string | null;
  readonly r2_key: string | null;
}

export interface OwnershipLookupResult {
  /** Verdict per requested key. Every requested key is present. */
  readonly verdicts: ReadonlyMap<string, OwnershipVerdict>;
  /** Impossible-but-checked states worth an operator's attention. */
  readonly inconsistencies: readonly DbInconsistency[];
  /** How many SELECTs were issued (for the report's cost accounting). */
  readonly queries: number;
}

/**
 * Resolve ownership for a set of candidate keys.
 *
 * A thrown database error is NOT swallowed: it propagates so the scanner can mark the whole scan
 * incomplete. Reporting "0 orphans" off a failed lookup would be the single most dangerous thing
 * this subsystem could do.
 */
export async function lookupOwnership(
  db: OwnershipQuery,
  keys: readonly string[],
  batchSize: number = DB_LOOKUP_BATCH_SIZE,
): Promise<OwnershipLookupResult> {
  const verdicts = new Map<string, OwnershipVerdict>();
  const inconsistencies: DbInconsistency[] = [];
  if (keys.length === 0) return { verdicts, inconsistencies, queries: 0 };

  const unique = Array.from(new Set(keys));
  let queries = 0;

  // Count rows per key so a duplicate `upload_key` — which the 0053 partial unique index should
  // make impossible — is REPORTED rather than silently collapsed by the map.
  const uploadKeyHits = new Map<string, number>();
  const r2KeyHits = new Set<string>();

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const rows = await db.query<OwnerRow>(
      `select upload_key, r2_key
         from public.photos
        where upload_key = any($1::text[])
           or r2_key = any($1::text[])`,
      [batch],
    );
    queries += 1;
    for (const row of rows) {
      if (typeof row.upload_key === 'string' && row.upload_key.length > 0) {
        uploadKeyHits.set(row.upload_key, (uploadKeyHits.get(row.upload_key) ?? 0) + 1);
      }
      if (typeof row.r2_key === 'string' && row.r2_key.length > 0) r2KeyHits.add(row.r2_key);
    }
  }

  for (const [key, count] of uploadKeyHits) {
    if (count > 1)
      inconsistencies.push({ kind: 'duplicate-upload-key', uploadKey: key, rowCount: count });
  }

  for (const key of unique) {
    const uploadHits = uploadKeyHits.get(key) ?? 0;
    if (uploadHits > 0) {
      verdicts.set(key, { state: 'owned', via: 'upload_key', duplicateRows: uploadHits });
    } else if (r2KeyHits.has(key)) {
      // Legacy/in-flight row that carries the key on `r2_key` only. Owned either way.
      verdicts.set(key, { state: 'owned', via: 'r2_key' });
    } else {
      verdicts.set(key, { state: 'unowned' });
    }
  }

  return { verdicts, inconsistencies, queries };
}
