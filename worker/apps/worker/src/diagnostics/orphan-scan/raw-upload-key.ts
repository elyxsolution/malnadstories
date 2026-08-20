/**
 * THE RAW-UPLOAD KEY PARSER — one authoritative, strict reader of the R2 key contract.
 *
 * THE CONTRACT, taken from the code that mints keys, not from assumption:
 *
 *   RAW UPLOAD   {userId}/albums/{albumId}/{uuid}.{jpg|png|heic|webp}
 *                └── src/app/api/photos/presign/route.ts
 *                      `${user.id}/albums/${albumId}/${randomUUID()}.${ext}`
 *                      ext ∈ ALLOWED_CONTENT_TYPES (src/lib/r2.ts): jpg · png · heic · webp
 *
 * Everything else in the bucket is a DIFFERENT object class and can never be a candidate:
 *
 *   sanitized master  {userId}/albums/{albumId}/{uuid}_full.jpg    worker processors/image/keys.ts
 *   thumbnail         {userId}/albums/{albumId}/{uuid}_thumb.jpg   worker processors/image/keys.ts
 *   album preview PDF {userId}/albums/{albumId}/preview.pdf        worker processors/pdf/pdf-contract.ts
 *   cover artwork     cover-templates/{uuid}.{ext}                 src/lib/actions/admin/covers.ts
 *   product artwork   album-products/{uuid}.{ext}                  src/lib/actions/admin/product-uploads.ts
 *   sticker artwork   stickers/{uuid}.{ext}                        src/lib/actions/admin/stickers.ts
 *
 * WHY THE DERIVATIVES CANNOT COLLIDE WITH A RAW KEY: `derivedKeys` appends `_full` / `_thumb` to
 * the stem, and a v4 UUID contains no underscore. So "basename is a bare UUID plus an allowed
 * extension" separates the two classes exactly, with no suffix blacklist to keep in sync.
 *
 * NO LOOSE MATCHING. There is no `includes('raw')`, no prefix sniffing, and no inference from
 * filenames. A key either satisfies the full structural contract — three segments, both ids valid
 * UUIDs, literal `albums` separator, bare-UUID basename, allowed extension — or it is not a raw
 * upload. Anything ambiguous inside the album namespace is reported as MALFORMED and protected,
 * never quietly treated as a candidate.
 */

/** Canonical lowercase v4-shaped UUID. Matches what `crypto.randomUUID()` emits. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Extensions the presign route can mint, from `ALLOWED_CONTENT_TYPES` in `src/lib/r2.ts`:
 * image/jpeg → jpg · image/png → png · image/heic → heic · image/webp → webp.
 */
export const RAW_UPLOAD_EXTENSIONS: readonly string[] = ['jpg', 'png', 'heic', 'webp'];

/** Top-level prefixes owned by admin/global assets. Never part of the raw-upload namespace. */
export const NON_USER_NAMESPACES: readonly string[] = [
  'cover-templates/',
  'album-products/',
  'stickers/',
];

/** The literal path segment separating the user id from the album id. */
const ALBUMS_SEGMENT = 'albums';

/** A successfully parsed raw upload. */
export interface RawUploadKey {
  /** The full key — which IS the upload identity (`photos.upload_key`). */
  readonly key: string;
  readonly userId: string;
  readonly albumId: string;
  /** The per-upload UUID that forms the basename. */
  readonly uploadId: string;
  readonly extension: string;
}

/** Why a key inside the album namespace failed the raw-upload contract. */
export type RawKeyRejection =
  /** Not in the album namespace at all (admin asset, unknown prefix, wrong depth). */
  | 'not-in-namespace'
  /** A known non-raw object class: `_full` / `_thumb` derivative, or `preview.pdf`. */
  | 'other-object-class'
  /** In the album namespace, but structurally invalid — this is the MALFORMED case. */
  | 'malformed';

export type ParseResult =
  | { readonly ok: true; readonly value: RawUploadKey }
  | { readonly ok: false; readonly rejection: RawKeyRejection; readonly detail: string };

/**
 * Parse an R2 key against the raw-upload contract.
 *
 * Returns `ok: true` ONLY for a key the presign route could have minted. The rejection reason
 * distinguishes "this is some other kind of object, ignore it" from "this is in the album
 * namespace but I cannot read it", because only the latter deserves an operator's attention.
 */
export function parseRawUploadKey(key: string): ParseResult {
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, rejection: 'not-in-namespace', detail: 'empty key' };
  }

  // Reject anything that could escape or confuse a prefix comparison before looking further.
  if (key.includes('..') || key.includes('//') || key.startsWith('/')) {
    return { ok: false, rejection: 'not-in-namespace', detail: 'suspicious path syntax' };
  }

  for (const ns of NON_USER_NAMESPACES) {
    if (key.startsWith(ns)) {
      return { ok: false, rejection: 'not-in-namespace', detail: `admin namespace ${ns}` };
    }
  }

  const parts = key.split('/');
  // Exactly three segments: user / "albums" / album / basename is four. Anything else is not the
  // album namespace — including deeper nesting, which the presign route can never produce.
  if (parts.length !== 4) {
    return {
      ok: false,
      rejection: 'not-in-namespace',
      detail: `path depth ${parts.length}, expected 4`,
    };
  }

  const [userId, albumsSegment, albumId, basename] = parts as [string, string, string, string];
  if (albumsSegment !== ALBUMS_SEGMENT) {
    return {
      ok: false,
      rejection: 'not-in-namespace',
      detail: `second segment "${albumsSegment}"`,
    };
  }
  if (!UUID.test(userId) || !UUID.test(albumId)) {
    // Not provably inside a real album namespace, so not our business to flag.
    return {
      ok: false,
      rejection: 'not-in-namespace',
      detail: 'user or album segment is not a UUID',
    };
  }

  // ── From here the object IS inside a genuine album namespace. ─────────────────────────────
  // A rejection below therefore means MALFORMED (worth reporting), not "some other object" —
  // except for the object classes we positively recognise.

  if (basename === 'preview.pdf') {
    return { ok: false, rejection: 'other-object-class', detail: 'album preview PDF' };
  }

  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) {
    return { ok: false, rejection: 'malformed', detail: 'basename has no usable extension' };
  }
  const stem = basename.slice(0, dot);
  // CASE-SENSITIVE on purpose. `ALLOWED_CONTENT_TYPES` maps to lowercase extensions only, so
  // presign can never mint `.JPG`. Normalising the case here would widen the candidate set beyond
  // what the mint contract can produce — the wrong direction for a detector that feeds deletion.
  const extension = basename.slice(dot + 1);

  // Derivatives are the ONLY things that carry a suffix on the stem, and a UUID has no underscore.
  if (stem.endsWith('_full') || stem.endsWith('_thumb')) {
    return { ok: false, rejection: 'other-object-class', detail: 'worker-generated derivative' };
  }

  if (!UUID.test(stem)) {
    return { ok: false, rejection: 'malformed', detail: 'basename stem is not a bare UUID' };
  }
  if (!RAW_UPLOAD_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      rejection: 'malformed',
      detail: `extension "${extension}" is not an allowed upload type`,
    };
  }

  return { ok: true, value: { key, userId, albumId, uploadId: stem, extension } };
}

/**
 * Whether a key sits inside SOME album namespace, regardless of whether it is a raw upload.
 * Used to decide if a parse failure is worth reporting as MALFORMED or is simply out of scope.
 */
export function isInAlbumNamespace(key: string): boolean {
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  const [userId, albumsSegment, albumId] = parts as [string, string, string, string];
  return albumsSegment === ALBUMS_SEGMENT && UUID.test(userId) && UUID.test(albumId);
}

/** True for a canonical lowercase UUID. Exported for scope validation. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
