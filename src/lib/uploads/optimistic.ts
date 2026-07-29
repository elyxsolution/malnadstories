/**
 * TEMPORARY PHOTO IDS — the identity scheme that lets a photo exist, and be placed into a
 * layout, before the server has ever heard of it.
 *
 * THE SCHEME. A temp id is `tmp_<taskId>`, where `taskId` is the Upload Manager's own
 * task id (a UUID). Three properties fall out of that, and all three matter:
 *
 *   • UNIQUE + NON-COLLIDING. Backend photo ids are bare UUIDs, which can never begin with
 *     `tmp_`. So `isTempPhotoId` is exact — not a heuristic — and a temp id can never be
 *     mistaken for a real one, in either direction.
 *   • STABLE ACROSS RENDERS. It is derived once, when the task is created in the manager,
 *     and stored on the task. React re-renders, remounts and history snapshots all see the
 *     same string.
 *   • REVERSIBLE. The task id is recoverable from the photo id (`taskIdOfTempPhoto`), so a
 *     photo can find its upload — progress, queue position, failure — with no extra field
 *     to keep in sync. That is deliberately a derivation rather than a stored `taskId`:
 *     duplicated state is state that can drift.
 *
 * THE HARD RULE: a temp id NEVER reaches the server. `saveLayout` validates that every
 * referenced photo belongs to the album, so a temp id would fail the whole save. The
 * mapping layer (see `_use-id-map`) resolves them at the serialization boundary, and
 * anything still unresolved is stripped.
 */

export const TEMP_PHOTO_PREFIX = 'tmp_';

/** The optimistic photo id for an upload task. */
export function tempPhotoId(taskId: string): string {
  return `${TEMP_PHOTO_PREFIX}${taskId}`;
}

/** True when this id belongs to a client-only optimistic photo. */
export function isTempPhotoId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(TEMP_PHOTO_PREFIX);
}

/** The upload task behind an optimistic photo id, or null for a real (server) id. */
export function taskIdOfTempPhoto(id: string | null | undefined): string | null {
  return isTempPhotoId(id) ? (id as string).slice(TEMP_PHOTO_PREFIX.length) : null;
}
