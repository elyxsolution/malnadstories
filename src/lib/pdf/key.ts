/**
 * THE ALBUM PREVIEW-PDF KEY — app-side mirror of the worker's render contract.
 *
 * MUST STAY IDENTICAL TO:
 *   worker/apps/worker/src/processors/pdf/pdf-contract.ts → previewPdfKey()
 * That module is the renderer of record: it is the only code that WRITES the object. The literal
 * format is pinned by a worker test (`pdf-deletion-race.test.ts`), so a change there fails loudly
 * and this mirror must be updated with it.
 *
 * WHY THE APP NEEDS IT AT ALL (Phase 6 Prompt 12). `album_pdfs.r2_key` is null for the ENTIRE
 * duration of a render — the generator deliberately omits it so a previously-generated PDF stays
 * downloadable until the new one lands. If the worker dies between the R2 upload and finalize, the
 * object exists while `r2_key` is still null; a deletion at that moment would collect no PDF key,
 * cascade the row away, and strand the object with nothing left in the database able to name it.
 *
 * Because the key is DETERMINISTIC in (userId, albumId), deletion never needs the stored value: it
 * can always reconstruct the one key a render could possibly have written. That reconstruction —
 * not a reservation table — is the durable ownership answer.
 */

/** The private R2 key of an album's preview PDF. Deterministic: one key per (user, album). */
export function previewPdfKey(userId: string, albumId: string): string {
  return `${userId}/albums/${albumId}/preview.pdf`;
}
