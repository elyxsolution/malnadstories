/**
 * DERIVED R2 KEYS — the sanitized master + thumbnail keys are a pure, DETERMINISTIC function of the raw
 * upload key (strip the extension, append a fixed suffix). Determinism is the backbone of idempotency:
 * re-processing the same photo writes the SAME two keys, so a retry OVERWRITES rather than duplicating —
 * no orphaned objects, ever. The convention matches the one the delete/cleanup paths already assume.
 */

/** `{prefix}/{uuid}.jpg` → `{prefix}/{uuid}_full.jpg` (master) + `{prefix}/{uuid}_thumb.jpg` (thumbnail). */
export function derivedKeys(rawKey: string): { sanitizedKey: string; thumbKey: string } {
  const base = rawKey.replace(/\.[^./]+$/, '');
  return { sanitizedKey: `${base}_full.jpg`, thumbKey: `${base}_thumb.jpg` };
}

/** The prefix a photo's raw key must live under: `{userId}/albums/{albumId}/` (defense in depth). */
export function expectedPrefix(userId: string, albumId: string): string {
  return `${userId}/albums/${albumId}/`;
}
