/**
 * THE ALBUM PDF KEYS — app-side mirror of the worker's render contract.
 *
 * MUST STAY IDENTICAL TO:
 *   worker/apps/worker/src/processors/pdf/pdf-contract.ts → previewPdfKey() / albumPdfKey()
 * That module is the renderer of record: it is the only code that WRITES the objects. The literal
 * formats are pinned by a worker test (`pdf-deletion-race.test.ts`), so a change there fails loudly
 * and this mirror must be updated with it.
 *
 * WHY THE APP NEEDS THEM AT ALL (Phase 6 Prompt 12). `album_pdfs.r2_key` is null for the ENTIRE
 * duration of a render — the generator deliberately omits it so a previously-generated PDF stays
 * downloadable until the new one lands. If the worker dies between the R2 upload and finalize, the
 * object exists while `r2_key` is still null; a deletion at that moment would collect no PDF key,
 * cascade the row away, and strand the object with nothing left in the database able to name it.
 *
 * Because every key is DETERMINISTIC in (userId, albumId, kind), deletion never needs the stored
 * value: it can always reconstruct the one key a render of that kind could possibly have written.
 * That reconstruction — not a reservation table — is the durable ownership answer, and it is why
 * the two PRINT artifacts are as reclaimable as the preview has always been.
 */

import { DEFAULT_PDF_KIND, PDF_KINDS, type PdfKind } from './kind';

/** The basename each kind's object is written under, inside the album's own namespace. */
const BASENAME: Record<PdfKind, string> = {
  preview: 'preview.pdf',
  print_cover: 'print-cover.pdf',
  print_content: 'print-content.pdf',
};

/**
 * Every PDF basename an album namespace can legitimately contain.
 *
 * The orphan scanner's key parser recognises exactly this set as a known non-raw object class, so
 * adding a kind here (and in the worker's mirror) is what stops a new artifact from being reported
 * as a malformed key — or, worse, from becoming a candidate for deletion.
 */
export const ALBUM_PDF_BASENAMES: readonly string[] = PDF_KINDS.map((k) => BASENAME[k]);

/** The private R2 key of one album PDF. Deterministic: one key per (user, album, kind). */
export function albumPdfKey(userId: string, albumId: string, kind: PdfKind = DEFAULT_PDF_KIND): string {
  return `${userId}/albums/${albumId}/${BASENAME[kind]}`;
}

/**
 * The private R2 key of an album's preview PDF. Deterministic: one key per (user, album).
 * Kept as its own named export because it is the pre-existing contract — the literal string is
 * asserted by tests and referenced by the orphan-scan documentation.
 */
export function previewPdfKey(userId: string, albumId: string): string {
  return albumPdfKey(userId, albumId, 'preview');
}

/** The private R2 key of an album's printer-ready flat cover spread. */
export function printCoverPdfKey(userId: string, albumId: string): string {
  return albumPdfKey(userId, albumId, 'print_cover');
}

/** The private R2 key of an album's printer-ready interior pages. */
export function printContentPdfKey(userId: string, albumId: string): string {
  return albumPdfKey(userId, albumId, 'print_content');
}
