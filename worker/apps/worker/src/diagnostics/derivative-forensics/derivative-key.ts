/**
 * DERIVATIVE KEY FORENSICS — a strict, PURE reader of the master/thumbnail key contract.
 *
 * THIS IS A DIAGNOSTIC, NOT A CLEANUP BASIS. Phase 6 Prompt 5 is a read-only investigation:
 * nothing in this directory deletes, writes, or enqueues anything, and parsing a key here does
 * NOT establish that the object is unowned. Ownership authority is `photos.sanitized_key` /
 * `photos.thumb_key` (see `inventory.ts`), never the key's shape.
 *
 * THE CONTRACT, taken from the code that mints these keys:
 *
 *   raw upload   {userId}/albums/{albumId}/{uploadId}.{jpg|png|heic|webp}
 *                └── src/app/api/photos/presign/route.ts
 *
 *   master       {userId}/albums/{albumId}/{uploadId}_full.jpg
 *   thumbnail    {userId}/albums/{albumId}/{uploadId}_thumb.jpg
 *                └── worker/apps/worker/src/processors/image/keys.ts → derivedKeys()
 *                      base = rawKey minus its extension; suffix `_full.jpg` / `_thumb.jpg`
 *
 * TWO PROPERTIES THAT MATTER MORE THAN THE FORMAT ITSELF:
 *
 *   1. DETERMINISTIC. A derivative key is a pure function of the raw key, so re-processing the
 *      same photo writes the SAME two keys. A retry OVERWRITES; it cannot accumulate a second
 *      copy. This is why "many derivatives, few rows" can never be explained by retries.
 *   2. ALWAYS OUTPUT AS A PAIR. `PersistStage` writes the master and the thumbnail back to back
 *      before anything is marked ready, so a lone master or a lone thumbnail is anomalous and
 *      worth an operator's attention.
 *
 * Both extensions are always `.jpg` regardless of the source format — the codec re-encodes to
 * JPEG — so the raw key is NOT recoverable from a derivative key (the original extension is
 * lost). That asymmetry is recorded in `rawKeyCandidates`.
 */

/** Canonical lowercase v4-shaped UUID, matching `crypto.randomUUID()` output. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const MASTER_KEY = new RegExp(`^(${UUID})/albums/(${UUID})/(${UUID})_full\\.jpg$`);
const THUMB_KEY = new RegExp(`^(${UUID})/albums/(${UUID})/(${UUID})_thumb\\.jpg$`);

/** Extensions the presign route can mint — the candidate set a derivative could have come from. */
export const RAW_EXTENSIONS: readonly string[] = ['jpg', 'png', 'heic', 'webp'];

export type DerivativeKind = 'master' | 'thumbnail';

export interface DerivativeKey {
  readonly key: string;
  readonly kind: DerivativeKind;
  readonly userId: string;
  readonly albumId: string;
  /** The upload UUID shared with the raw object and with this derivative's sibling. */
  readonly uploadId: string;
  /** `{user}/albums/{album}/{uploadId}` — the stem both siblings share. */
  readonly base: string;
  /**
   * The raw keys this derivative COULD have come from. Plural because the codec always emits
   * `.jpg`, so a `_full.jpg` may descend from a `.png`, `.heic` or `.webp` original. Useful for
   * cross-referencing `photos.upload_key`; never sufficient on its own to prove ownership.
   */
  readonly rawKeyCandidates: readonly string[];
}

/**
 * Parse a derivative key. Returns `null` for anything that is not EXACTLY a master or thumbnail
 * in the album namespace — raw uploads, `preview.pdf`, `cover-templates/`, `album-products/`,
 * `stickers/`, malformed keys, wrong depth, non-UUID segments.
 */
export function parseDerivativeKey(key: string): DerivativeKey | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  if (key.includes('..') || key.includes('//') || key.startsWith('/')) return null;

  const master = MASTER_KEY.exec(key);
  const thumb = master === null ? THUMB_KEY.exec(key) : null;
  const m = master ?? thumb;
  if (m === null) return null;

  const [, userId, albumId, uploadId] = m as unknown as [string, string, string, string];
  const base = `${userId}/albums/${albumId}/${uploadId}`;
  return {
    key,
    kind: master === null ? 'thumbnail' : 'master',
    userId,
    albumId,
    uploadId,
    base,
    rawKeyCandidates: RAW_EXTENSIONS.map((ext) => `${base}.${ext}`),
  };
}

/**
 * The worker's own derivation, mirrored for cross-referencing: given a raw upload key, the two
 * derivative keys it will produce. Kept byte-identical to
 * `worker/apps/worker/src/processors/image/keys.ts → derivedKeys()`; the duplication is
 * deliberate so this diagnostic cannot alter the production processor by importing it, and it is
 * asserted equal in the tests.
 */
export function derivativeKeysForRaw(rawKey: string): { master: string; thumbnail: string } {
  const base = rawKey.replace(/\.[^./]+$/, '');
  return { master: `${base}_full.jpg`, thumbnail: `${base}_thumb.jpg` };
}

/** The sibling of a derivative — the other half of the pair `PersistStage` always writes. */
export function siblingKey(parsed: DerivativeKey): string {
  return parsed.kind === 'master' ? `${parsed.base}_thumb.jpg` : `${parsed.base}_full.jpg`;
}
