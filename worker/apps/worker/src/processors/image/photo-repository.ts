import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';

/**
 * PHOTO REPOSITORY — the thin, table-aware layer over the generic `DatabaseAdapter` (Phase I-0). It is
 * the ONLY place that knows the `photos` columns; it holds no pipeline logic. Reads scope by id; writes
 * are the exact server-only transitions the schema reserves for the worker (status + derivative keys +
 * dimensions + capture date + raw-key clearing). Every statement is parameterized and idempotent
 * (keyed by primary id), which is the database half of the pipeline's restart-safety.
 *
 * The worker connects with the service-role (DIRECT) connection, so these writes bypass RLS by design —
 * exactly the columns the app's `authenticated` role is forbidden from touching.
 */

/** The subset of a `photos` row the pipeline needs. */
export interface PhotoRow {
  readonly id: string;
  readonly userId: string;
  readonly albumId: string | null;
  readonly rawKey: string | null;
  readonly status: string;
  readonly originalFilename: string;
}

/** The derivative facts written when a photo becomes `ready`. */
export interface ReadyFields {
  readonly sanitizedKey: string;
  readonly thumbKey: string;
  readonly width: number;
  readonly height: number;
  readonly takenAt: Date | null;
}

/**
 * The photo persistence seam the pipeline depends on. Injected as an interface so the processor + stages
 * are tested against an in-memory fake, while `PhotoRepository` is the production implementation over the
 * `DatabaseAdapter`.
 */
export interface PhotoStore {
  findById(photoId: string): Promise<PhotoRow | null>;
  markReady(photoId: string, fields: ReadyFields): Promise<void>;
  markRejected(photoId: string): Promise<void>;
  clearRawKey(photoId: string): Promise<void>;
  // --- Recovery reads (bounded; Phase I-3) ---
  /** Photo ids stuck in `pending` since before `olderThan` (upload processed but never hardened). */
  findStalePending(olderThan: Date, limit: number): Promise<readonly string[]>;
  /** `ready` photos whose raw key is still set (a prior run crashed between mark-ready and raw-delete). */
  findReadyNeedingCleanup(limit: number): Promise<readonly { id: string; rawKey: string }[]>;
}

interface RawPhotoRow {
  readonly id: string;
  readonly user_id: string;
  readonly album_id: string | null;
  readonly r2_key: string | null;
  readonly status: string;
  readonly original_filename: string;
}

export class PhotoRepository implements PhotoStore {
  constructor(private readonly db: DatabaseAdapter) {}

  /** Load a photo by id, or `null` when the row no longer exists (e.g. deleted mid-flight). */
  async findById(photoId: string): Promise<PhotoRow | null> {
    const rows = await this.db.query<RawPhotoRow>(
      'select id, user_id, album_id, r2_key, status, original_filename from photos where id = $1',
      [photoId],
    );
    const row = rows[0];
    return row === undefined ? null : mapRow(row);
  }

  /**
   * Mark a photo `ready` with its derivative keys, dimensions, and capture date. Idempotent (keyed by
   * id). Deliberately leaves `r2_key` intact — the raw object is deleted and the key cleared in a
   * SEPARATE step (`clearRawKey`), so a crash between "ready" and "raw deleted" leaves the key available
   * for a retry to finish the cleanup (zero orphans).
   */
  async markReady(photoId: string, fields: ReadyFields): Promise<void> {
    await this.db.query(
      `update photos
         set status = 'ready',
             sanitized_key = $2,
             thumb_key = $3,
             width = $4,
             height = $5,
             taken_at = $6
       where id = $1`,
      [photoId, fields.sanitizedKey, fields.thumbKey, fields.width, fields.height, fields.takenAt],
    );
  }

  /** Mark a photo `rejected` (terminal). Idempotent. */
  async markRejected(photoId: string): Promise<void> {
    await this.db.query(`update photos set status = 'rejected' where id = $1`, [photoId]);
  }

  /** Null the raw upload key after the raw object has been deleted. Idempotent. */
  async clearRawKey(photoId: string): Promise<void> {
    await this.db.query('update photos set r2_key = null where id = $1', [photoId]);
  }

  async findStalePending(olderThan: Date, limit: number): Promise<readonly string[]> {
    const rows = await this.db.query<{ id: string }>(
      `select id from photos where status = 'pending' and uploaded_at < $1 order by uploaded_at asc limit $2`,
      [olderThan, limit],
    );
    return rows.map((r) => r.id);
  }

  async findReadyNeedingCleanup(limit: number): Promise<readonly { id: string; rawKey: string }[]> {
    const rows = await this.db.query<{ id: string; r2_key: string }>(
      `select id, r2_key from photos where status = 'ready' and r2_key is not null limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.id, rawKey: r.r2_key }));
  }
}

function mapRow(row: RawPhotoRow): PhotoRow {
  return {
    id: row.id,
    userId: row.user_id,
    albumId: row.album_id,
    rawKey: row.r2_key,
    status: row.status,
    originalFilename: row.original_filename,
  };
}
