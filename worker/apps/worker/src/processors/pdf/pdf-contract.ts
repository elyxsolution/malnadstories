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
  /** Chromium could not connect to the configured render base URL (refused / timeout / TLS). */
  | 'render_unreachable'
  /** The render base URL's hostname does not resolve. */
  | 'render_dns_failed'
  | 'print_route_error'
  | 'render_empty'
  /**
   * The file rendered, but its printed geometry is wrong — Chromium laid a page out on a sheet
   * that does not match that page's own MediaBox, so the artwork would print undersized in a
   * corner of the paper. TRANSIENT: the recovery sweep re-drives it, and the bytes are discarded.
   */
  | 'render_geometry_invalid'
  | 'upload_failed'
  | 'db_update_failed'
  | 'token_expired'
  | 'album_missing'
  | 'render_failed';

/**
 * THE ARTWORK SIZE, IN MILLIMETRES, of each printer-ready artifact — a MIRROR of the print
 * specification, which lives in ONE place: the app's src/lib/print/spec.ts (INTERIOR_ARTWORK and
 * COVER_ARTWORK). Worker V2 is a separate deployable workspace with no path into the app's source,
 * so it is copied here under the same rule as everything else in this file, and
 * tests/print-spec.test.ts asserts the two agree so they cannot drift apart silently.
 *
 * These are the sizes a PRINTER is expecting, so they are fixed and knowable ahead of the render.
 * The preview book is deliberately null: its page size follows the album's product and it also
 * carries a narrow spine page, so no single expected size exists for it — the unit invariant in
 * pdf-geometry.ts checks every one of its pages against that page's own MediaBox instead.
 */
export const PRINT_ARTWORK_MM: Record<PdfKind, { readonly w: number; readonly h: number } | null> = {
  preview: null,
  print_cover: { w: 487, h: 327 },
  print_content: { w: 206, h: 291 },
};

/** Millimetres to PDF points — the fixed unit conversion, not a page size. */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

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

/**
 * REDACT THE PRINT TOKEN from any string that might contain a render URL.
 *
 * The token in `?t=` IS the authorization for the print route. Chromium puts the full URL into its
 * navigation errors — `net::ERR_CONNECTION_REFUSED at http://host/albums/<id>/print?t=<token>` —
 * and that message used to travel unmodified into the log line, the processor event, and
 * `album_pdfs.error`, which the admin console renders. A short-lived, single-use token is still a
 * credential; it does not belong in any of those places.
 *
 * Applied at every boundary where a message could carry a URL, so redaction does not depend on
 * remembering to call it at the one site that happens to log today.
 */
export function redactToken(text: string): string {
  return text.replace(/([?&]t=)[^&\s"')]+/gi, '$1[REDACTED]');
}

/** The render URL with its token removed — safe to log, safe to store, safe to show an admin. */
export function redactedPrintUrl(url: string): string {
  return redactToken(url);
}
