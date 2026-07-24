import { createHash } from 'node:crypto';

/**
 * PDF CONTRACT — the cross-process constants + vocabulary the worker shares with the app's print route
 * and `album_pdfs` schema. Because Worker V2 is a separate workspace, these cannot be imported from the
 * app; they are MIRRORED here (the same pattern the app's `src/lib/pdf/status.ts` documents). Keep the
 * two in sync. This is the entire "coupling" between the worker and the print route — everything else is
 * an opaque HTTP call to the rendering engine.
 */

/** The in-page global the print route flips to `true` when the album has finished painting. */
export const PRINT_READY_FLAG = '__ALBUM_PRINT_READY';

/** `album_pdfs.stage` vocabulary (progress) — mirrors `PdfStage` in the app. */
export type PdfStage =
  'queued' | 'preparing' | 'rendering' | 'uploading' | 'finalizing' | 'completed';

/** `album_pdfs.failure_code` vocabulary (the subset the worker produces) — mirrors `PdfFailureCode`. */
export type PdfFailureCode =
  | 'render_timeout'
  | 'render_engine_failed'
  | 'print_route_error'
  | 'render_empty'
  | 'upload_failed'
  | 'db_update_failed'
  | 'token_expired'
  | 'album_missing'
  | 'render_failed';

/** The private R2 key of an album's preview PDF — deterministic (the backbone of idempotency). */
export function previewPdfKey(userId: string, albumId: string): string {
  return `${userId}/albums/${albumId}/preview.pdf`;
}

/** The print-route URL Chromium navigates to (token in the query string only). */
export function printUrl(appUrl: string, albumId: string, token: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/albums/${albumId}/print?t=${encodeURIComponent(token)}`;
}

/** sha256 hex of a print token — compared against the stored `album_pdfs.token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
