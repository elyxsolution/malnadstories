/**
 * DERIVATIVE OWNERSHIP INVENTORY — read-only forensics over masters and thumbnails.
 *
 * ZERO MUTATION. It lists R2 through the Prompt-2 read-only lister (which has no write or delete
 * method) and issues exactly one kind of statement — a batched `SELECT` — against Postgres. There
 * is no `DeleteObjectCommand` in this directory, no cleanup entrypoint, and no scheduler.
 *
 * THE OWNERSHIP MODEL IT TESTS. Unlike raw uploads, derivatives have EXPLICIT ownership columns:
 * `photos.sanitized_key` (master) and `photos.thumb_key` (thumbnail), written by the worker's
 * `markReady`. So the authoritative question is simply "does a photo row name this key?" — no
 * reconstruction required.
 *
 * A SECOND, WEAKER SIGNAL IS ALSO COLLECTED, and the distinction is the whole point of this
 * investigation. Between `PersistStage` (which writes both objects) and `FinalizeStage` (which
 * writes the columns) there is a real window where a legitimate derivative exists with NO column
 * referencing it. During that window the only thing that connects the object to a row is the
 * DERIVED key of a still-`pending` photo's raw upload. `RECONSTRUCTED_PENDING` records exactly
 * that case, so it is never confused with a genuinely abandoned object.
 */

import type { ReadOnlyObjectLister } from '../orphan-scan/index.js';
import type { OwnershipQuery } from '../orphan-scan/index.js';
import type { ListedObject } from '../orphan-scan/classify.js';
import { derivativeKeysForRaw, parseDerivativeKey, type DerivativeKey } from './derivative-key.js';

/** How an object relates to the database. Deliberately NOT a deletion verdict. */
export type DerivativeOwnership =
  /** A photo row names this exact key in `sanitized_key` / `thumb_key`. Definitively in use. */
  | 'OWNED'
  /**
   * No column names it, but it is the derived key of a photo row that has not finished
   * processing (`pending`). This is the legitimate PersistStage→FinalizeStage window.
   */
  | 'RECONSTRUCTED_PENDING'
  /**
   * No photo row references it by column, and no unfinished row derives it. NOT a deletion
   * verdict — it means "no authoritative DB relationship could be established".
   */
  | 'NO_DB_REFERENCE';

export interface DerivativeRecord {
  readonly key: string;
  readonly kind: 'master' | 'thumbnail';
  readonly userId: string;
  readonly albumId: string;
  readonly uploadId: string;
  readonly sizeBytes: number | null;
  readonly lastModified: string | null;
  readonly etag: string | null;
  readonly ownership: DerivativeOwnership;
  /** Whether the album named in the key still exists. Diagnostic context only. */
  readonly albumExists: boolean;
  /** Whether this object's pair-sibling is also present in R2. */
  readonly hasSibling: boolean;
}

export interface DerivativeInventory {
  readonly generatedAt: string;
  readonly scanComplete: boolean;
  readonly errors: readonly string[];

  readonly totalObjects: number;
  readonly masters: number;
  readonly thumbnails: number;
  readonly nonDerivative: number;

  readonly owned: number;
  readonly reconstructedPending: number;
  readonly noDbReference: number;

  /** Derivative pairs (a master and its thumbnail share one base). */
  readonly distinctBases: number;
  readonly masterWithoutThumbnail: readonly string[];
  readonly thumbnailWithoutMaster: readonly string[];

  readonly photoRows: number;
  readonly photoRowsWithMasterKey: number;
  readonly photoRowsWithThumbKey: number;
  /** Rows whose named derivative is NOT present in R2 — a dangling DB reference. */
  readonly danglingReferences: readonly string[];

  /** Unreferenced objects grouped by album, split by whether the album still exists. */
  readonly unreferencedInLiveAlbums: number;
  readonly unreferencedInDeletedAlbums: number;
  readonly albumsWithUnreferenced: number;

  readonly records: readonly DerivativeRecord[];
}

interface PhotoOwnershipRow {
  readonly sanitized_key: string | null;
  readonly thumb_key: string | null;
  readonly upload_key: string | null;
  readonly r2_key: string | null;
  readonly status: string;
}

export interface InventoryOptions {
  readonly lister: ReadOnlyObjectLister;
  readonly db: OwnershipQuery;
  /** Empty string = whole bucket. Derivatives live under `{user}/albums/{album}/`. */
  readonly prefix?: string;
  readonly pageSize?: number;
  readonly now?: () => number;
}

/**
 * Build the inventory. Read-only, batched (no N+1), and honest about incompleteness: any listing
 * or query failure sets `scanComplete: false`, because a partial inventory reporting few
 * unreferenced objects would be actively misleading.
 */
export async function buildDerivativeInventory(
  options: InventoryOptions,
): Promise<DerivativeInventory> {
  const now = options.now ?? (() => Date.now());
  const errors: string[] = [];
  const listed: ListedObject[] = [];
  const seen = new Set<string>();

  // ── 1. LIST (paginated, read-only) ────────────────────────────────────────────────────────
  let token: string | null = null;
  let complete = false;
  try {
    for (let page = 0; page < 10_000; page += 1) {
      const result = await options.lister.listPage({
        prefix: options.prefix ?? '',
        continuationToken: token,
        maxKeys: options.pageSize ?? 1000,
      });
      for (const o of result.objects) {
        if (seen.has(o.key)) continue;
        seen.add(o.key);
        listed.push(o);
      }
      token = result.nextToken;
      if (token === null) {
        complete = true;
        break;
      }
    }
  } catch (error) {
    errors.push(`list: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 2. PARSE ──────────────────────────────────────────────────────────────────────────────
  const derivatives: { object: ListedObject; parsed: DerivativeKey }[] = [];
  let nonDerivative = 0;
  for (const object of listed) {
    const parsed = parseDerivativeKey(object.key);
    if (parsed === null) nonDerivative += 1;
    else derivatives.push({ object, parsed });
  }
  const present = new Set(derivatives.map((d) => d.object.key));

  // ── 3. THE AUTHORITATIVE LOOKUP — one pass over `photos`, not per object. ─────────────────
  const ownedKeys = new Set<string>();
  const pendingDerived = new Set<string>();
  let photoRows = 0;
  let withMaster = 0;
  let withThumb = 0;
  const dangling: string[] = [];
  try {
    const rows = await options.db.query<PhotoOwnershipRow>(
      `select sanitized_key, thumb_key, upload_key, r2_key, status from public.photos`,
    );
    photoRows = rows.length;
    for (const r of rows) {
      if (r.sanitized_key !== null) {
        withMaster += 1;
        ownedKeys.add(r.sanitized_key);
        if (!present.has(r.sanitized_key)) dangling.push(r.sanitized_key);
      }
      if (r.thumb_key !== null) {
        withThumb += 1;
        ownedKeys.add(r.thumb_key);
        if (!present.has(r.thumb_key)) dangling.push(r.thumb_key);
      }
      // The PersistStage→FinalizeStage window: an unfinished row whose derived keys may already
      // exist in R2. Protected as RECONSTRUCTED_PENDING, never counted as unreferenced.
      if (r.status !== 'ready') {
        for (const raw of [r.upload_key, r.r2_key]) {
          if (raw === null) continue;
          const { master, thumbnail } = derivativeKeysForRaw(raw);
          pendingDerived.add(master);
          pendingDerived.add(thumbnail);
        }
      }
    }
  } catch (error) {
    errors.push(`db: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ── 4. WHICH ALBUMS STILL EXIST (context, not authority) ─────────────────────────────────
  const albumIds = Array.from(new Set(derivatives.map((d) => d.parsed.albumId)));
  const liveAlbums = new Set<string>();
  if (albumIds.length > 0) {
    try {
      const rows = await options.db.query<{ id: string }>(
        `select id::text as id from public.albums where id = any($1::uuid[])`,
        [albumIds],
      );
      for (const r of rows) liveAlbums.add(r.id);
    } catch (error) {
      errors.push(`albums: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── 5. CLASSIFY ───────────────────────────────────────────────────────────────────────────
  const records: DerivativeRecord[] = [];
  const masterBases = new Set<string>();
  const thumbBases = new Set<string>();
  let owned = 0;
  let reconstructed = 0;
  let noRef = 0;
  let unrefLive = 0;
  let unrefDead = 0;
  const unrefAlbums = new Set<string>();

  for (const { object, parsed } of derivatives) {
    (parsed.kind === 'master' ? masterBases : thumbBases).add(parsed.base);
    const sibling =
      parsed.kind === 'master' ? `${parsed.base}_thumb.jpg` : `${parsed.base}_full.jpg`;

    const ownership: DerivativeOwnership = ownedKeys.has(object.key)
      ? 'OWNED'
      : pendingDerived.has(object.key)
        ? 'RECONSTRUCTED_PENDING'
        : 'NO_DB_REFERENCE';

    if (ownership === 'OWNED') owned += 1;
    else if (ownership === 'RECONSTRUCTED_PENDING') reconstructed += 1;
    else {
      noRef += 1;
      unrefAlbums.add(parsed.albumId);
      if (liveAlbums.has(parsed.albumId)) unrefLive += 1;
      else unrefDead += 1;
    }

    records.push({
      key: object.key,
      kind: parsed.kind,
      userId: parsed.userId,
      albumId: parsed.albumId,
      uploadId: parsed.uploadId,
      sizeBytes: object.sizeBytes,
      lastModified: object.lastModified,
      etag: object.etag,
      ownership,
      albumExists: liveAlbums.has(parsed.albumId),
      hasSibling: present.has(sibling),
    });
  }

  const allBases = new Set([...masterBases, ...thumbBases]);
  return {
    generatedAt: new Date(now()).toISOString(),
    scanComplete: complete && errors.length === 0,
    errors,
    totalObjects: listed.length,
    masters: masterBases.size,
    thumbnails: thumbBases.size,
    nonDerivative,
    owned,
    reconstructedPending: reconstructed,
    noDbReference: noRef,
    distinctBases: allBases.size,
    masterWithoutThumbnail: [...masterBases].filter((b) => !thumbBases.has(b)),
    thumbnailWithoutMaster: [...thumbBases].filter((b) => !masterBases.has(b)),
    photoRows,
    photoRowsWithMasterKey: withMaster,
    photoRowsWithThumbKey: withThumb,
    danglingReferences: dangling,
    unreferencedInLiveAlbums: unrefLive,
    unreferencedInDeletedAlbums: unrefDead,
    albumsWithUnreferenced: unrefAlbums.size,
    records,
  };
}
