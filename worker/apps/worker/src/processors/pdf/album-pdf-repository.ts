import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import { DEFAULT_PDF_KIND, isPdfKind } from './pdf-contract.js';
import type { PdfFailureCode, PdfKind, PdfStage } from './pdf-contract.js';

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
  /** WHICH artifact is stuck (0058) — the sweep must re-drive that one, not the album's others. */
  readonly kind: PdfKind;
  readonly attempts: number;
}

export interface AlbumPdfStore {
  /** `albums.user_id`, or `null` when the album no longer exists. */
  findAlbumOwner(albumId: string): Promise<AlbumOwner | null>;
  /** Current `album_pdfs` token state, or `null` when there is no row. */
  findPdfState(albumId: string, kind: PdfKind): Promise<PdfState | null>;
  /** Best-effort progress write (gated to a still-generating row). */
  setStage(albumId: string, kind: PdfKind, stage: PdfStage): Promise<void>;
  /**
   * Finalize success: point the row at the uploaded PDF. Idempotent.
   *
   * Returns whether a row was actually updated. `false` means the `album_pdfs` row no longer
   * exists — the album was deleted while this render was in flight and the CASCADE took the row
   * with it. The caller MUST NOT treat that as success: the PDF bytes are already in R2 with
   * nothing left to name them (Phase 6 Prompt 10).
   */
  markReady(albumId: string, kind: PdfKind, r2Key: string): Promise<boolean>;
  /** Finalize failure with a typed code. Idempotent. */
  markFailed(albumId: string, kind: PdfKind, message: string, code: PdfFailureCode): Promise<void>;
  // --- Recovery (bounded; Phase I-3) ---
  /** Rows stuck `generating` since before `olderThan` (crashed / expired mid-render). */
  findStaleGenerating(olderThan: Date, limit: number): Promise<readonly StaleGeneration[]>;
  /** Re-drive: reset the row to `generating` with a fresh token + bumped attempt count. Idempotent. */
  redrive(
    albumId: string,
    kind: PdfKind,
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

  async findPdfState(albumId: string, kind: PdfKind): Promise<PdfState | null> {
    const rows = await this.db.query<RawState>(
      'select status, token_hash, token_expires_at from album_pdfs where album_id = $1 and kind = $2',
      [albumId, kind],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { status: row.status, tokenHash: row.token_hash, tokenExpiresAt: row.token_expires_at };
  }

  async setStage(albumId: string, kind: PdfKind, stage: PdfStage): Promise<void> {
    await this.db.query(
      `update album_pdfs set stage = $3 where album_id = $1 and kind = $2 and status = 'generating'`,
      [albumId, kind, stage],
    );
  }

  async markReady(albumId: string, kind: PdfKind, r2Key: string): Promise<boolean> {
    // RETURNING makes the affected-row count observable: a plain UPDATE that matches nothing
    // raises no error, which is exactly how a deleted album used to be reported as a success.
    const rows = await this.db.query<{ album_id: string }>(
      `update album_pdfs
         set status = 'ready', stage = 'completed', failure_code = null, error = null,
             r2_key = $3, generated_at = now()
       where album_id = $1 and kind = $2
       returning album_id`,
      [albumId, kind, r2Key],
    );
    return rows.length > 0;
  }

  async markFailed(albumId: string, kind: PdfKind, message: string, code: PdfFailureCode): Promise<void> {
    await this.db.query(
      `update album_pdfs set status = 'failed', error = $3, failure_code = $4
        where album_id = $1 and kind = $2`,
      [albumId, kind, message.slice(0, 500), code],
    );
  }

  async findStaleGenerating(olderThan: Date, limit: number): Promise<readonly StaleGeneration[]> {
    const rows = await this.db.query<{ album_id: string; kind: string | null; attempts: number | null }>(
      `select album_id, kind, attempts from album_pdfs
        where status = 'generating' and requested_at < $1
        order by requested_at asc limit $2`,
      [olderThan, limit],
    );
    // A pre-0058 row (or a database not yet migrated) reports no kind — that can only be a preview.
    return rows.map((r) => ({
      albumId: r.album_id,
      kind: isPdfKind(r.kind) ? r.kind : DEFAULT_PDF_KIND,
      attempts: r.attempts ?? 0,
    }));
  }

  async redrive(
    albumId: string,
    kind: PdfKind,
    tokenHash: string,
    tokenExpiresAt: string,
    attempts: number,
  ): Promise<void> {
    // Guarded to a still-generating row: if a concurrent sweep or a slow render already moved it on,
    // this updates nothing (idempotent, race-safe).
    await this.db.query(
      `update album_pdfs
         set stage = 'queued', failure_code = null, error = null,
             token_hash = $3, token_expires_at = $4, token_used_at = null,
             requested_at = now(), attempts = $5
       where album_id = $1 and kind = $2 and status = 'generating'`,
      [albumId, kind, tokenHash, tokenExpiresAt, attempts],
    );
  }
}
