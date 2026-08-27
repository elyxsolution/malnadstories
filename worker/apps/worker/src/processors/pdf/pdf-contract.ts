import { createHash } from 'node:crypto';

/**
 * PDF CONTRACT — the cross-process constants + vocabulary the worker shares with the app's print
 * routes and `album_pdfs` schema. Because Worker V2 is a separate workspace, these cannot be
 * imported from the app; they are MIRRORED here (the same pattern the app's `src/lib/pdf/status.ts`
 * documents). Keep the two in sync. This is the entire "coupling" between the worker and the print
 * routes — everything else is an opaque HTTP call to the rendering engine.
 *
 * App-side mirrors:
 *   PdfKind / basenames / albumPdfKey   →  src/lib/pdf/kind.ts + src/lib/pdf/key.ts
 *   route paths                         →  src/app/albums/[id]/print/{,cover,content}/page.tsx
 */

/** The in-page global the print route flips to `true` when the album has finished painting. */
export const PRINT_READY_FLAG = '__ALBUM_PRINT_READY';

/**
 * WHICH artifact an `album_pdfs` row / album-pdf job describes (0058).
 *
 *   preview        the customer-facing preview book — unchanged in every respect.
 *   print_cover    the printer-ready flat cover spread (one 483 x 327 mm page).
 *   print_content  the printer-ready interior (N x 206 x 291 mm pages).
 *
 * Each kind owns its own row, and therefore its own status, stage, token, attempt count and R2
 * object. That independence is the point: a failed print export must be retryable without
 * disturbing a preview the customer can already download.
 */
export const PDF_KINDS = ['preview', 'print_cover', 'print_content'] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

/** The default kind. An absent value means `preview` — including in a job enqueued before 0058. */
export const DEFAULT_PDF_KIND: PdfKind = 'preview';

export function isPdfKind(value: unknown): value is PdfKind {
  return typeof value === 'string' && (PDF_KINDS as readonly string[]).includes(value);
}

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

/** The object basename each kind is written under, inside the album's own R2 namespace. */
const BASENAME: Record<PdfKind, string> = {
  preview: 'preview.pdf',
  print_cover: 'print-cover.pdf',
  print_content: 'print-content.pdf',
};

/**
 * Every PDF basename an album namespace can legitimately contain.
 *
 * The orphan scanner's key parser recognises exactly this set as a known non-raw object class.
 * Adding a kind without adding it here would make its object look MALFORMED to the scan.
 */
export const ALBUM_PDF_BASENAMES: readonly string[] = PDF_KINDS.map((k) => BASENAME[k]);

/**
 * The private R2 key of one album PDF — deterministic in (userId, albumId, kind), which is the
 * backbone of idempotency AND of reclaimability: `deleteAlbum` can reconstruct every key a render
 * could possibly have written, even while `album_pdfs.r2_key` is still null mid-render.
 */
export function albumPdfKey(userId: string, albumId: string, kind: PdfKind = DEFAULT_PDF_KIND): string {
  return `${userId}/albums/${albumId}/${BASENAME[kind]}`;
}

/** The private R2 key of an album's preview PDF. The pre-existing contract, pinned by tests. */
export function previewPdfKey(userId: string, albumId: string): string {
  return albumPdfKey(userId, albumId, 'preview');
}

/** The print-route path segment each kind renders from. */
const ROUTE: Record<PdfKind, string> = {
  preview: '',
  print_cover: '/cover',
  print_content: '/content',
};

/**
 * The print-route URL Chromium navigates to (token in the query string only).
 *
 * Each kind has its OWN route, and each route validates the token against its OWN row, so a token
 * minted for one artifact can never render another.
 */
export function printUrl(
  appUrl: string,
  albumId: string,
  token: string,
  kind: PdfKind = DEFAULT_PDF_KIND,
): string {
  const base = appUrl.replace(/\/+$/, '');
  return `${base}/albums/${albumId}/print${ROUTE[kind]}?t=${encodeURIComponent(token)}`;
}

/** sha256 hex of a print token — compared against the stored `album_pdfs.token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
