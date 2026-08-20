/**
 * PREVIEW-PDF OWNERSHIP — "does the database still claim this exact PDF?", answered in BATCHES.
 *
 * TWO INDEPENDENT AUTHORITIES, and BOTH must say no before an object is even a candidate:
 *
 *   1. `album_pdfs.r2_key = <key>`  — a row that names this exact object. The direct owner.
 *   2. `albums.id = <albumId>`      — the album itself. This is the one that matters during a
 *      render: `album_pdfs.r2_key` is NULL for the entire duration of a generation (the generator
 *      omits it so a previously-generated PDF stays downloadable), so an in-flight PDF has NO row
 *      naming it. Requiring the album to be absent is what stops this tool from deleting a PDF
 *      that a worker is uploading right now.
 *
 * That second gate is exactly the Prompt-12 crash window, read from the safe side: while the album
 * lives, recovery can still heal the row and adopt the object, so the object is never ours to take.
 * Only once the album is gone — and with it any possibility of a row ever naming the key again —
 * does the object become unreclaimable by any other mechanism, which is precisely when this tool
 * is the right answer.
 *
 * NO N+1: one `= any($1)` query per batch per authority. READ-ONLY: every statement is a SELECT.
 */

/** The minimal query surface needed. Satisfied by the worker's `DatabaseAdapter`, and by a fake. */
export interface PreviewOwnershipQuery {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]>;
}

/** Ownership verdict for one preview-PDF key. */
export type PreviewOwnershipVerdict =
  /** An `album_pdfs` row names this exact key. */
  | { readonly state: 'owned'; readonly via: 'album_pdfs.r2_key' }
  /** No row names it, but the owning album still exists — a render may be in flight. */
  | { readonly state: 'album-exists' }
  /** No row names it and the album is gone. Reclaimable, subject to the age gates. */
  | { readonly state: 'unowned' };

export interface PreviewOwnershipResult {
  readonly verdicts: ReadonlyMap<string, PreviewOwnershipVerdict>;
  readonly queries: number;
}

export const OWNERSHIP_BATCH_SIZE = 500;

/**
 * Resolve ownership for a set of preview-PDF keys.
 *
 * A thrown database error is NOT swallowed: it propagates so the caller can mark the run
 * incomplete. Reporting "0 owners" off a failed lookup would be the most dangerous possible bug in
 * this subsystem.
 */
export async function lookupPreviewOwnership(
  db: PreviewOwnershipQuery,
  candidates: readonly { readonly key: string; readonly albumId: string }[],
  batchSize: number = OWNERSHIP_BATCH_SIZE,
): Promise<PreviewOwnershipResult> {
  const verdicts = new Map<string, PreviewOwnershipVerdict>();
  if (candidates.length === 0) return { verdicts, queries: 0 };

  const keys = Array.from(new Set(candidates.map((c) => c.key)));
  const albumIds = Array.from(new Set(candidates.map((c) => c.albumId)));
  let queries = 0;

  // Authority 1 — rows that name the exact key.
  const referenced = new Set<string>();
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const rows = await db.query<{ r2_key: string | null }>(
      `select r2_key from public.album_pdfs where r2_key = any($1::text[])`,
      [batch],
    );
    queries += 1;
    for (const r of rows) if (typeof r.r2_key === 'string' && r.r2_key) referenced.add(r.r2_key);
  }

  // Authority 2 — albums that still exist.
  const livingAlbums = new Set<string>();
  for (let i = 0; i < albumIds.length; i += batchSize) {
    const batch = albumIds.slice(i, i + batchSize);
    const rows = await db.query<{ id: string }>(
      `select id::text as id from public.albums where id = any($1::uuid[])`,
      [batch],
    );
    queries += 1;
    for (const r of rows) if (r.id) livingAlbums.add(r.id);
  }

  for (const c of candidates) {
    if (referenced.has(c.key)) {
      verdicts.set(c.key, { state: 'owned', via: 'album_pdfs.r2_key' });
    } else if (livingAlbums.has(c.albumId)) {
      verdicts.set(c.key, { state: 'album-exists' });
    } else {
      verdicts.set(c.key, { state: 'unowned' });
    }
  }

  return { verdicts, queries };
}
