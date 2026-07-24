import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { PdfFailureCode, PdfStage } from './pdf-contract.js';

/**
 * ALBUM-PDF REPOSITORY — the table-aware layer over the generic `DatabaseAdapter` for `albums` (owner
 * lookup) + `album_pdfs` (token state + status transitions). It is the ONLY place that knows those
 * columns and holds no pipeline logic. Injected as an interface so the pipeline is tested with an
 * in-memory fake; every write is parameterized + idempotent (keyed by album_id). `setStage` is gated on
 * `status='generating'` so a progress write can never resurrect a superseded/failed row.
 */

export interface AlbumOwner {
  readonly userId: string;
}

export interface PdfState {
  readonly status: string;
  readonly tokenHash: string | null;
  readonly tokenExpiresAt: string | null;
}

/** A generation stuck in `generating` past its stale window (worker crashed / job expired mid-render). */
export interface StaleGeneration {
  readonly albumId: string;
  readonly attempts: number;
}

export interface AlbumPdfStore {
  /** `albums.user_id`, or `null` when the album no longer exists. */
  findAlbumOwner(albumId: string): Promise<AlbumOwner | null>;
  /** Current `album_pdfs` token state, or `null` when there is no row. */
  findPdfState(albumId: string): Promise<PdfState | null>;
  /** Best-effort progress write (gated to a still-generating row). */
  setStage(albumId: string, stage: PdfStage): Promise<void>;
  /** Finalize success: point the row at the uploaded PDF. Idempotent. */
  markReady(albumId: string, r2Key: string): Promise<void>;
  /** Finalize failure with a typed code. Idempotent. */
  markFailed(albumId: string, message: string, code: PdfFailureCode): Promise<void>;
  // --- Recovery (bounded; Phase I-3) ---
  /** Rows stuck `generating` since before `olderThan` (crashed / expired mid-render). */
  findStaleGenerating(olderThan: Date, limit: number): Promise<readonly StaleGeneration[]>;
  /** Re-drive: reset the row to `generating` with a fresh token + bumped attempt count. Idempotent. */
  redrive(
    albumId: string,
    tokenHash: string,
    tokenExpiresAt: string,
    attempts: number,
  ): Promise<void>;
}

interface RawOwner {
  readonly user_id: string;
}
interface RawState {
  readonly status: string;
  readonly token_hash: string | null;
  readonly token_expires_at: string | null;
}

export class AlbumPdfRepository implements AlbumPdfStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async findAlbumOwner(albumId: string): Promise<AlbumOwner | null> {
    const rows = await this.db.query<RawOwner>('select user_id from albums where id = $1', [
      albumId,
    ]);
    const row = rows[0];
    return row === undefined ? null : { userId: row.user_id };
  }

  async findPdfState(albumId: string): Promise<PdfState | null> {
    const rows = await this.db.query<RawState>(
      'select status, token_hash, token_expires_at from album_pdfs where album_id = $1',
      [albumId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { status: row.status, tokenHash: row.token_hash, tokenExpiresAt: row.token_expires_at };
  }

  async setStage(albumId: string, stage: PdfStage): Promise<void> {
    await this.db.query(
      `update album_pdfs set stage = $2 where album_id = $1 and status = 'generating'`,
      [albumId, stage],
    );
  }

  async markReady(albumId: string, r2Key: string): Promise<void> {
    await this.db.query(
      `update album_pdfs
         set status = 'ready', stage = 'completed', failure_code = null, error = null,
             r2_key = $2, generated_at = now()
       where album_id = $1`,
      [albumId, r2Key],
    );
  }

  async markFailed(albumId: string, message: string, code: PdfFailureCode): Promise<void> {
    await this.db.query(
      `update album_pdfs set status = 'failed', error = $2, failure_code = $3 where album_id = $1`,
      [albumId, message.slice(0, 500), code],
    );
  }

  async findStaleGenerating(olderThan: Date, limit: number): Promise<readonly StaleGeneration[]> {
    const rows = await this.db.query<{ album_id: string; attempts: number | null }>(
      `select album_id, attempts from album_pdfs
        where status = 'generating' and requested_at < $1
        order by requested_at asc limit $2`,
      [olderThan, limit],
    );
    return rows.map((r) => ({ albumId: r.album_id, attempts: r.attempts ?? 0 }));
  }

  async redrive(
    albumId: string,
    tokenHash: string,
    tokenExpiresAt: string,
    attempts: number,
  ): Promise<void> {
    // Guarded to a still-generating row: if a concurrent sweep or a slow render already moved it on,
    // this updates nothing (idempotent, race-safe).
    await this.db.query(
      `update album_pdfs
         set stage = 'queued', failure_code = null, error = null,
             token_hash = $2, token_expires_at = $3, token_used_at = null,
             requested_at = now(), attempts = $4
       where album_id = $1 and status = 'generating'`,
      [albumId, tokenHash, tokenExpiresAt, attempts],
    );
  }
}
