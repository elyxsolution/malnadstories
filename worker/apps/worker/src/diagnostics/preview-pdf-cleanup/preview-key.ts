/**
 * THE PREVIEW-PDF KEY PARSER — a SEPARATE object class from raw uploads.
 *
 * THE CONTRACT, taken from the code that mints the key, not from assumption:
 *
 *   album preview PDF   {userId}/albums/{albumId}/preview.pdf
 *                       └── worker/apps/worker/src/processors/pdf/pdf-contract.ts → previewPdfKey()
 *                       └── mirrored app-side by src/lib/pdf/key.ts (pinned by a worker test)
 *
 * WHY THIS FILE EXISTS INSTEAD OF A CHANGE TO `raw-upload-key.ts`. That parser deliberately
 * classifies `preview.pdf` as `other-object-class` so a PDF can never enter the raw-upload
 * candidate set. Loosening it to make PDFs eligible would put two object classes with completely
 * different ownership rules through one set of gates — the raw path proves ownership against
 * `photos`, which knows nothing about PDFs. So preview PDFs get their own parser, their own
 * ownership lookup, and their own proof type, and the raw path is left byte-for-byte untouched.
 *
 * PARSING IS UNAMBIGUOUS. The basename is the fixed literal `preview.pdf` and both ids are
 * canonical v4-shaped UUIDs, so `userId` and `albumId` are recovered exactly — there is no
 * heuristic and no guessing. Anything that does not satisfy the full structure is not a preview
 * PDF, and this module refuses to reason about it at all.
 */

/** Canonical lowercase v4-shaped UUID — what `crypto.randomUUID()` emits. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The literal path segment between the user id and the album id. */
const ALBUMS_SEGMENT = 'albums';

/** The literal basename. Case-sensitive: the contract only ever emits this exact string. */
const PREVIEW_BASENAME = 'preview.pdf';

/** Top-level prefixes owned by admin/global assets. Never part of the preview-PDF namespace. */
export const ADMIN_NAMESPACES: readonly string[] = [
  'cover-templates/',
  'album-products/',
  'stickers/',
];

/** A successfully parsed preview-PDF key. */
export interface PreviewPdfKey {
  /** The full key — exactly what would be deleted. */
  readonly key: string;
  readonly userId: string;
  readonly albumId: string;
}

/** Why a key is not a preview PDF. */
export type PreviewKeyRejection =
  /** An admin/global namespace — explicitly out of scope for this reclamation. */
  | 'admin-namespace'
  /** Not shaped like a preview PDF at all (wrong depth, wrong basename, non-UUID segments). */
  | 'not-a-preview-pdf'
  /** Inside a genuine album namespace but structurally unreadable — worth an operator's attention. */
  | 'malformed';

export type PreviewParseResult =
  | { readonly ok: true; readonly value: PreviewPdfKey }
  | { readonly ok: false; readonly rejection: PreviewKeyRejection; readonly detail: string };

/**
 * Parse an R2 key against the preview-PDF contract.
 *
 * Returns `ok: true` ONLY for a key the PDF pipeline could have written. Every other input is a
 * typed refusal, so "not examined" is never confused with "examined and found safe to delete".
 */
export function parsePreviewPdfKey(key: string): PreviewParseResult {
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, rejection: 'not-a-preview-pdf', detail: 'empty key' };
  }
  // Reject anything that could escape or confuse a prefix comparison before looking further.
  if (key.includes('..') || key.includes('//') || key.startsWith('/')) {
    return { ok: false, rejection: 'not-a-preview-pdf', detail: 'suspicious path syntax' };
  }
  for (const ns of ADMIN_NAMESPACES) {
    if (key.startsWith(ns)) {
      return { ok: false, rejection: 'admin-namespace', detail: `admin namespace ${ns}` };
    }
  }

  const parts = key.split('/');
  if (parts.length !== 4) {
    return { ok: false, rejection: 'not-a-preview-pdf', detail: `path depth ${parts.length}, expected 4` };
  }
  const [userId, albumsSegment, albumId, basename] = parts as [string, string, string, string];
  if (albumsSegment !== ALBUMS_SEGMENT) {
    return { ok: false, rejection: 'not-a-preview-pdf', detail: `second segment "${albumsSegment}"` };
  }
  if (!UUID.test(userId) || !UUID.test(albumId)) {
    return { ok: false, rejection: 'not-a-preview-pdf', detail: 'user or album segment is not a UUID' };
  }

  // From here the key IS inside a genuine album namespace.
  if (basename !== PREVIEW_BASENAME) {
    // A master/thumbnail/raw upload — a different class entirely, handled by the raw + derivative
    // tooling. Not malformed, just not ours.
    return { ok: false, rejection: 'not-a-preview-pdf', detail: `basename "${basename}"` };
  }

  return { ok: true, value: { key, userId, albumId } };
}

/** Rebuild the canonical key. Used to prove a parsed identity round-trips to the exact input. */
export function previewPdfKeyFor(userId: string, albumId: string): string {
  return `${userId}/albums/${albumId}/${PREVIEW_BASENAME}`;
}
