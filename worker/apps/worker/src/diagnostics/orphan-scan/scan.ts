/**
 * THE ORPHAN SCAN — list → parse → batch-lookup → classify → report.
 *
 * READ-ONLY, TOTAL, AND HONEST ABOUT FAILURE. It performs exactly two kinds of I/O: `ListObjectsV2`
 * against R2 (through a lister that has no write or delete method), and `SELECT` against Postgres.
 * It writes nothing, enqueues nothing, and deletes nothing — there is no deletion function in this
 * subsystem to call.
 *
 * SCAN COMPLETENESS IS THE HEADLINE FACT. Any listing or lookup failure sets `scanComplete: false`
 * and records the stage. A report that says `orphanCandidates: 0` with `scanComplete: false` means
 * "I did not finish looking", and the two fields must always be read together — which is why the
 * CLI prints the flag before the counts.
 */

import { randomUUID } from 'node:crypto';
import {
  CLOCK_SKEW_ALLOWANCE_MS,
  LIST_PAGE_SIZE,
  MAX_LIST_PAGES,
  ORPHAN_MIN_AGE_MS,
  type ClassifiedObject,
  type DbInconsistency,
  type OrphanScanReport,
  type ScanError,
  type ScanScope,
} from './model.js';
import { classifyObject, type ListedObject, type OwnershipVerdict } from './classify.js';
import { lookupOwnership, type OwnershipQuery } from './photo-lookup.js';
import type { ReadOnlyObjectLister } from './object-lister.js';
import { parseRawUploadKey } from './raw-upload-key.js';

export interface ScanOptions {
  readonly lister: ReadOnlyObjectLister;
  readonly db: OwnershipQuery;
  readonly scope: ScanScope;
  readonly minAgeMs?: number;
  readonly clockSkewAllowanceMs?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  /** Injected clock, so the age boundary is deterministic under test. */
  readonly now?: () => number;
  /** Structured progress callback. Never receives secrets. */
  readonly onProgress?: (event: { page: number; objects: number; scanId: string }) => void;
}

export async function runOrphanScan(options: ScanOptions): Promise<OrphanScanReport> {
  const scanId = randomUUID();
  const startedAt = Date.now();
  const now = options.now ?? (() => Date.now());
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const skewMs = options.clockSkewAllowanceMs ?? CLOCK_SKEW_ALLOWANCE_MS;
  const pageSize = options.pageSize ?? LIST_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_LIST_PAGES;

  const errors: ScanError[] = [];
  const inconsistencies: DbInconsistency[] = [];
  const classified: ClassifiedObject[] = [];

  /** Deduped by key — a backend that repeats a key across pages must not double-count it. */
  const seen = new Map<string, ListedObject>();
  let scanned = 0;
  let duplicateListingEntries = 0;
  let pagesListed = 0;
  let dbLookups = 0;
  let listingComplete = false;

  // ── 1. LIST (paginated to exhaustion) ─────────────────────────────────────────────────────
  let token: string | null = null;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await options.lister.listPage({
        prefix: options.scope.prefix,
        continuationToken: token,
        maxKeys: pageSize,
      });
      pagesListed = page;
      for (const object of result.objects) {
        scanned += 1;
        if (seen.has(object.key)) {
          duplicateListingEntries += 1;
          continue;
        }
        seen.set(object.key, object);
      }
      options.onProgress?.({ page, objects: result.objects.length, scanId });
      token = result.nextToken;
      if (token === null) {
        listingComplete = true;
        break;
      }
    }
    if (!listingComplete && token !== null) {
      errors.push({
        stage: 'list',
        message: `listing stopped at the ${maxPages}-page safety ceiling with more pages remaining`,
        page: pagesListed,
      });
    }
  } catch (error) {
    errors.push({ stage: 'list', message: toMessage(error), page: pagesListed + 1 });
  }

  // ── 2. PARSE — only raw uploads need a database answer ────────────────────────────────────
  // Sorted for deterministic output regardless of listing order.
  const objects = Array.from(seen.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const candidateKeys: string[] = [];
  for (const object of objects) {
    const parsed = parseRawUploadKey(object.key);
    if (parsed.ok) candidateKeys.push(parsed.value.key);
  }

  // ── 3. BATCHED OWNERSHIP LOOKUP ───────────────────────────────────────────────────────────
  let verdicts: ReadonlyMap<string, OwnershipVerdict> = new Map();
  let lookupFailed: string | null = null;
  try {
    const result = await lookupOwnership(options.db, candidateKeys);
    verdicts = result.verdicts;
    dbLookups = result.queries;
    inconsistencies.push(...result.inconsistencies);
  } catch (error) {
    // A failed lookup must NEVER read as "nothing is owned". Every candidate becomes
    // UNDETERMINED (protected) and the scan is marked incomplete.
    lookupFailed = toMessage(error);
    errors.push({ stage: 'db-lookup', message: lookupFailed });
  }

  // ── 4. CLASSIFY ───────────────────────────────────────────────────────────────────────────
  const at = now();
  for (const object of objects) {
    const parsed = parseRawUploadKey(object.key);
    const ownership: OwnershipVerdict = !parsed.ok
      ? { state: 'unowned' } // ignored for non-candidates; the classifier decides on the key first
      : lookupFailed !== null
        ? { state: 'undetermined', detail: lookupFailed }
        : (verdicts.get(parsed.value.key) ?? {
            state: 'undetermined',
            detail: 'key missing from the lookup result',
          });

    classified.push(
      classifyObject({ object, ownership, now: at, minAgeMs, clockSkewAllowanceMs: skewMs }),
    );
  }

  // ── 5. TALLY ──────────────────────────────────────────────────────────────────────────────
  const count = (c: ClassifiedObject['classification']): number =>
    classified.reduce((n, o) => (o.classification === c ? n + 1 : n), 0);

  const owned = count('OWNED');
  const notRawUpload = count('NOT_RAW_UPLOAD');
  const malformed = count('MALFORMED_KEY');
  const recentUnconfirmed = count('RECENT_UNCONFIRMED');
  const unknownAge = count('UNKNOWN_AGE');
  const clockSkewProtected = count('CLOCK_SKEW_PROTECTED');
  const undetermined = count('UNDETERMINED');
  const orphanCandidates = count('ORPHAN_CANDIDATE');

  return {
    scanId,
    generatedAt: new Date(at).toISOString(),
    durationMs: Date.now() - startedAt,
    scope: options.scope,
    minAgeHours: minAgeMs / 3600000,
    clockSkewAllowanceMinutes: skewMs / 60000,
    scanComplete: errors.length === 0,
    scanned,
    duplicateListingEntries,
    candidates: classified.length - notRawUpload,
    owned,
    notRawUpload,
    malformed,
    recentUnconfirmed,
    unknownAge,
    clockSkewProtected,
    undetermined,
    orphanCandidates,
    // Derived §9 rollup: parsed as a raw upload but unowned, whatever the protection reason.
    unknownKey: recentUnconfirmed + unknownAge + clockSkewProtected + orphanCandidates,
    pagesListed,
    dbLookups,
    errors,
    dbInconsistencies: inconsistencies,
    objects: classified,
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
