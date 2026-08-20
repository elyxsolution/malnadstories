/**
 * ACCOUNT ASSET PREFLIGHT — what does this customer still own, and what R2 objects hang off it?
 *
 * WHY THIS EXISTS. Migration 0054 changed `photos.user_id` and `albums.user_id` from
 * ON DELETE CASCADE to ON DELETE RESTRICT, so deleting a profile that still owns storage now
 * fails loudly instead of silently stranding the objects. An operator who hits that error needs
 * to know exactly what is blocking them and which objects are at stake. That is this module.
 *
 * IT IS READ-ONLY, AND STRUCTURALLY SO. It issues `SELECT`s and nothing else — no DELETE, no
 * UPDATE, no enqueue, no R2 call of any kind. It reports what the correct, already-existing
 * cleanup paths would remove; it does not remove anything and cannot be made to.
 *
 * THE KEYS ARE READ, NOT DERIVED. `photos.r2_key`, `photos.sanitized_key`, `photos.thumb_key`
 * and `album_pdfs.r2_key` are explicit columns. Phase 6 Prompt 5 established that these are the
 * authoritative ownership records for raw uploads, masters, thumbnails and preview PDFs
 * respectively, so no key reconstruction is involved and none is appropriate here.
 */

/** The minimal query surface, satisfied by the worker's `DatabaseAdapter` and by a fake. */
export interface AssetQuery {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
}

/** Which lifecycle state a photo is in, and therefore which of its keys can be populated. */
export interface PhotoAssetRow {
  readonly id: string;
  readonly album_id: string | null;
  readonly status: string;
  readonly r2_key: string | null;
  readonly sanitized_key: string | null;
  readonly thumb_key: string | null;
}

export interface AccountAssets {
  readonly userId: string;
  readonly profileExists: boolean;
  /** True when 0054's RESTRICT would refuse a profile delete right now. */
  readonly deletionBlocked: boolean;
  readonly albums: number;
  readonly photos: number;
  readonly photosByStatus: Readonly<Record<string, number>>;
  readonly rawKeys: number;
  readonly masterKeys: number;
  readonly thumbnailKeys: number;
  readonly pdfKeys: number;
  /**
   * Every distinct R2 key this account still owns, deduplicated. This is exactly the list the
   * existing `deleteAlbum` path would hand to the `r2-cleanup` worker job — reported here so an
   * operator can see the scale before running the real cleanup.
   */
  readonly keys: readonly string[];
  /** Human-readable next step. */
  readonly guidance: string;
}

/**
 * Collect a photo row's owned keys.
 *
 * Deliberately state-agnostic: Phase 6 Prompt 5 established that the key columns — not the
 * status — say what exists. A `pending` photo normally holds only `r2_key`; a `ready` one
 * normally holds `sanitized_key` + `thumb_key` and a nulled `r2_key`; a `rejected` one keeps its
 * raw key forever; and a row caught between `PersistStage` and `FinalizeStage` can briefly have
 * objects in R2 that no column names yet. Reading whatever is non-null covers all of them
 * without encoding a status→key assumption that the lifecycle does not actually guarantee.
 */
export function keysOfPhoto(row: PhotoAssetRow): string[] {
  return [row.r2_key, row.sanitized_key, row.thumb_key].filter(
    (k): k is string => typeof k === 'string' && k.length > 0,
  );
}

/** Deduplicate while preserving first-seen order, so a report is stable between runs. */
export function dedupeKeys(keys: readonly string[]): string[] {
  return Array.from(new Set(keys));
}

/**
 * Build the preflight. Three `SELECT`s, all bounded by the single `userId`; no N+1 and no
 * unbounded scan.
 */
export async function collectAccountAssets(db: AssetQuery, userId: string): Promise<AccountAssets> {
  const profiles = await db.query<{ id: string }>(
    `select id::text as id from public.profiles where id = $1::uuid`,
    [userId],
  );
  const profileExists = profiles.length > 0;

  const photos = await db.query<PhotoAssetRow>(
    `select id::text as id, album_id::text as album_id, status, r2_key, sanitized_key, thumb_key
       from public.photos
      where user_id = $1::uuid`,
    [userId],
  );

  const pdfs = await db.query<{ r2_key: string | null }>(
    `select p.r2_key
       from public.album_pdfs p
       join public.albums a on a.id = p.album_id
      where a.user_id = $1::uuid and p.r2_key is not null`,
    [userId],
  );

  const albums = await db.query<{ n: number }>(
    `select count(*)::int as n from public.albums where user_id = $1::uuid`,
    [userId],
  );
  const albumCount = albums[0]?.n ?? 0;

  const byStatus: Record<string, number> = {};
  let raw = 0;
  let master = 0;
  let thumb = 0;
  const keys: string[] = [];
  for (const p of photos) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (p.r2_key) raw += 1;
    if (p.sanitized_key) master += 1;
    if (p.thumb_key) thumb += 1;
    keys.push(...keysOfPhoto(p));
  }
  const pdfKeys = pdfs
    .map((p) => p.r2_key)
    .filter((k): k is string => typeof k === 'string' && k.length > 0);
  keys.push(...pdfKeys);

  const blocked = albumCount > 0 || photos.length > 0;
  return {
    userId,
    profileExists,
    deletionBlocked: blocked,
    albums: albumCount,
    photos: photos.length,
    photosByStatus: byStatus,
    rawKeys: raw,
    masterKeys: master,
    thumbnailKeys: thumb,
    pdfKeys: pdfKeys.length,
    keys: dedupeKeys(keys),
    guidance: blocked
      ? 'Profile deletion is BLOCKED by 0054. Remove this customer’s albums through the application ' +
        '(deleteAlbum enqueues exact-key R2 cleanup via the existing worker job), confirm the objects ' +
        'are gone, then delete the profile. Do not delete rows directly — that is what stranded the ' +
        'historical objects.'
      : profileExists
        ? 'This account owns no albums, photos or R2 objects. Deleting the profile strands nothing.'
        : 'No profile with this id exists.',
  };
}
