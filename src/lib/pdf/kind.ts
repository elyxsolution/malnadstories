/**
 * THE PDF KIND — which artifact an `album_pdfs` row describes.
 *
 * One album now has up to three independent PDFs, each with its own status, token, attempt count
 * and R2 object:
 *
 *   preview        the customer-facing preview book (cover + blanks + content + back + spine).
 *                  UNCHANGED by the print-export work: same route, same page sequence, same key,
 *                  same payment-triggered lifecycle.
 *   print_cover    the printer-ready flat cover spread (one 483 × 327 mm page). Admin-on-demand.
 *   print_content  the printer-ready interior (N × 206 × 291 mm pages). Admin-on-demand.
 *
 * PURE — no I/O, no `server-only` — so the client-side admin controls, the server actions, the API
 * route and the tests all share one vocabulary. The worker mirrors it in
 * `worker/apps/worker/src/processors/pdf/pdf-contract.ts` (separate workspace; keep in sync).
 */

export const PDF_KINDS = ['preview', 'print_cover', 'print_content'] as const;
export type PdfKind = (typeof PDF_KINDS)[number];

/** The default kind — every pre-existing row, caller and in-flight job means `preview`. */
export const DEFAULT_PDF_KIND: PdfKind = 'preview';

/** The two admin-on-demand printer-ready artifacts. */
export const PRINT_PDF_KINDS = ['print_cover', 'print_content'] as const satisfies readonly PdfKind[];

export function isPdfKind(value: unknown): value is PdfKind {
  return typeof value === 'string' && (PDF_KINDS as readonly string[]).includes(value);
}

/** Narrow an untrusted value to a kind, falling back to `preview`. */
export function toPdfKind(value: unknown): PdfKind {
  return isPdfKind(value) ? value : DEFAULT_PDF_KIND;
}

/** Human label for admin UI + audit metadata. */
export const PDF_KIND_LABEL: Record<PdfKind, string> = {
  preview: 'Preview PDF',
  print_cover: 'Print cover',
  print_content: 'Print content',
};

/** The filename an admin download is served as. */
export const PDF_KIND_FILENAME: Record<PdfKind, string> = {
  preview: 'album-preview.pdf',
  print_cover: 'print-cover.pdf',
  print_content: 'print-content.pdf',
};
