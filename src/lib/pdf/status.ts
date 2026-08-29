/**
 * PDF generation status vocabulary (audit Sections 6 & 8) — the shared contract for the `stage` and
 * `failure_code` columns on `album_pdfs` (0051).
 *
 * These are DB string values, so the SAME literals are written by the standalone worker
 * (worker/src/jobs/album-pdf.ts, which can't import this module across the package boundary — it
 * mirrors these strings with a pointer comment). This file is the single source of the vocabulary +
 * the human labels the UI renders. Keep the two in sync.
 */

// ── Stages (Section 6) — honest, real phases the worker passes through, in order ──────────────────
export type PdfStage = 'queued' | 'preparing' | 'rendering' | 'uploading' | 'finalizing' | 'completed';

export const PDF_STAGE_ORDER: PdfStage[] = ['queued', 'preparing', 'rendering', 'uploading', 'finalizing', 'completed'];

const STAGE_LABEL: Record<PdfStage, string> = {
  queued: 'Queued',
  preparing: 'Preparing assets',
  rendering: 'Rendering pages',
  uploading: 'Uploading PDF',
  finalizing: 'Finalizing',
  completed: 'Completed',
};

export function pdfStageLabel(stage: string | null | undefined): string {
  return stage && stage in STAGE_LABEL ? STAGE_LABEL[stage as PdfStage] : 'Preparing';
}

/** 1-based position of a stage in the pipeline (for a progress bar). 0 when unknown. */
export function pdfStageStep(stage: string | null | undefined): number {
  const i = stage ? PDF_STAGE_ORDER.indexOf(stage as PdfStage) : -1;
  return i < 0 ? 0 : i + 1;
}

// ── Typed failure codes (Section 8) — WHY a generation failed ─────────────────────────────────────
export type PdfFailureCode =
  | 'render_timeout' // a render stage exceeded its watchdog (nav / readiness / pdf)
  | 'render_engine_failed' // Chromium launch / page create failed
  | 'render_unreachable' // the worker could not CONNECT to the configured app URL (refused/timeout/TLS)
  | 'render_dns_failed' // the configured app URL's hostname does not resolve
  | 'print_route_error' // the print route returned a non-OK HTTP status
  | 'render_empty' // page.pdf produced 0 bytes
  // The file rendered, but a page's printed sheet disagreed with its own MediaBox, so the artwork
  // would print undersized in a corner. The bytes were discarded, never uploaded.
  | 'render_geometry_invalid'
  | 'upload_failed' // R2 putObject failed
  | 'upload_timeout' // R2 putObject exceeded its watchdog
  | 'db_update_failed' // the final status write failed
  | 'token_expired' // the print token expired before render
  | 'album_missing' // the album no longer exists
  | 'missing_cover_asset' // render-readiness: a cover asset didn't resolve
  | 'missing_photo' // render-readiness: a referenced photo is gone
  | 'photo_processing' // render-readiness: a referenced photo isn't ready yet
  | 'worker_offline' // no worker available to run the job
  | 'storage_failure' // generic R2 failure
  | 'render_failed'; // uncategorised render failure

/** Admin-facing precise reason (shown in the admin console + retry UI). */
const FAILURE_LABEL: Record<PdfFailureCode, string> = {
  render_timeout: 'Rendering timed out',
  render_engine_failed: 'Render engine failed to start',
  render_unreachable: 'Rendering service could not reach the site',
  render_dns_failed: 'Rendering service could not resolve the site address',
  print_route_error: 'Print page failed to load',
  render_empty: 'Renderer produced an empty file',
  render_geometry_invalid: 'Rendered file had the wrong page geometry',
  upload_failed: 'Storage upload failed',
  upload_timeout: 'Storage upload timed out',
  db_update_failed: 'Database update failed',
  token_expired: 'Print token expired before rendering',
  album_missing: 'Album no longer exists',
  missing_cover_asset: 'Cover asset could not be resolved',
  missing_photo: 'A referenced photo is missing',
  photo_processing: 'A photo is still processing',
  worker_offline: 'Rendering service is unavailable',
  storage_failure: 'Storage error',
  render_failed: 'Rendering failed',
};

export function pdfFailureLabel(code: string | null | undefined): string {
  if (code && code in FAILURE_LABEL) return FAILURE_LABEL[code as PdfFailureCode];
  return 'Generation failed';
}

/** Customer-safe one-liner — never leaks internal cause detail; reassures + sets expectation. */
export function pdfFailureCustomerNote(code: string | null | undefined): string {
  switch (code) {
    case 'photo_processing':
      return 'We’re still processing one of your photos. This will finish automatically.';
    case 'missing_photo':
    case 'missing_cover_asset':
      return 'We hit a snag preparing one of your images and are finalizing your album.';
    case 'render_timeout':
      return 'Your album is taking a little longer than usual to prepare. We’ll keep working on it.';
    case 'render_unreachable':
    case 'render_dns_failed':
      // Deliberately vague to the customer: the cause is our configuration, not their album, and
      // the admin console carries the precise reason.
      return 'We’re finishing your album — this will resume automatically.';
    case 'upload_failed':
    case 'upload_timeout':
    case 'storage_failure':
      return 'We’re uploading your album — please check back again shortly.';
    default:
      return 'We’re putting the finishing touches on your print-ready album and will email it shortly.';
  }
}

/** Admin-facing suggested next step for a failure — the "what do I do about it" line. */
export function pdfFailureRecommendation(code: string | null | undefined): string {
  switch (code) {
    case 'photo_processing':
      return 'Wait for image hardening to finish, then it retries automatically. No action usually needed.';
    case 'missing_photo':
    case 'missing_cover_asset':
      return 'A referenced asset is gone or unready. Check the album’s photos/cover, then regenerate.';
    case 'render_timeout':
      return 'Heavy album/slow render. It will be re-driven by recovery; if it persists, investigate render input size.';
    case 'render_engine_failed':
      return 'Chromium failed to start on the worker. Check the worker service health/memory.';
    case 'print_route_error':
      return 'The print route returned a non-OK status. Check APP_URL and the print route logs.';
    case 'render_geometry_invalid':
      return 'The render was rejected before upload because a page was laid out on the wrong sheet. Nothing was published. It re-drives automatically; if it persists, the print page has regained a content-driven page size.';
    case 'upload_failed':
    case 'upload_timeout':
    case 'storage_failure':
      return 'R2 upload failed. Check R2 credentials/connectivity, then retry.';
    case 'db_update_failed':
      return 'The status write failed after render. Retry; the file may already exist in R2.';
    case 'token_expired':
      return 'The print token expired before pickup (worker was asleep). Retry to mint a fresh token.';
    case 'worker_offline':
      return 'No worker available. Check the Render worker is running, then retry.';
    default:
      return 'Retry generation. If it keeps failing, check the worker logs for this album id.';
  }
}
