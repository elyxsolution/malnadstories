/**
 * THE PHOTO DRAG CONTRACT — one definition of how a photo travels between surfaces.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ─────────────────────────────────────────────────────────
 *
 * HTML5 drag-and-drop negotiates: the SOURCE declares `effectAllowed`, the TARGET answers with a
 * `dropEffect`, and if the two are incompatible the browser silently resets `dropEffect` to
 * `'none'`. That has two consequences, and the second one is the expensive one:
 *
 *   1. the pointer shows the "not allowed" cursor, and
 *   2. **the `drop` event never fires at all.**
 *
 * The builder had them disagreeing. The tray declared `effectAllowed: 'copy'`; a frame answered
 * `dropEffect: photo ? 'move' : 'copy'` — chosen from whether the DESTINATION was occupied. So
 * dropping a tray photo onto an occupied frame paired `copy` with `move`, the browser cancelled
 * the drop, and the entire replacement pipeline behind it (`place()` → `commands.placePhoto()` →
 * `api.batch()`) was unreachable. The mirror case was broken too and had not been noticed:
 * dragging a photo OFF a page (`effectAllowed: 'move'`) onto an EMPTY frame (`dropEffect: 'copy'`)
 * was rejected the same way.
 *
 * The mistake was conceptual, not clerical. `dropEffect` describes what happens to the SOURCE, not
 * what happens to the destination — so deriving it from the destination's occupancy could only
 * ever be right by luck.
 *
 * ── WHY EVERY PHOTO DRAG IS A MOVE ─────────────────────────────────────────────────────────
 *
 * A photo is placed AT MOST ONCE across the whole album — the invariant `stripPhoto` enforces on
 * every assignment. Dropping one onto a frame therefore always takes it from wherever it was: out
 * of the tray, or off the page it was on. There is no drag in this builder that leaves a copy
 * behind, so `'copy'` was never true, and the branch that produced it was describing something
 * that does not happen. One verb, declared here, used by every source and every target.
 *
 * PURE — no React, no I/O. The parameter types are structural so React's synthetic drag events
 * satisfy them without this module importing React.
 */

/** The payload key. A single constant, so a typo cannot silently create a drag nothing accepts. */
export const PHOTO_DND_MIME = 'text/photo-id';

type DragLike = { preventDefault: () => void; dataTransfer: DataTransfer };
type LeaveLike = { currentTarget: Node; relatedTarget: EventTarget | null };

/** Begin dragging a photo. Called by every source: tray tiles and filled frames alike. */
export function startPhotoDrag(e: { dataTransfer: DataTransfer }, photoId: string): void {
  e.dataTransfer.setData(PHOTO_DND_MIME, photoId);
  e.dataTransfer.effectAllowed = 'move';
}

/**
 * Accept a photo drag over this target — the `dragover` half of the negotiation.
 *
 * `preventDefault()` is what marks an element as a drop target at all; the matching `dropEffect`
 * is what stops the browser cancelling the drop after that. Both, every time, with no branch:
 * an OCCUPIED frame is exactly as valid a target as an empty one, because dropping onto it is a
 * replacement rather than an error.
 */
export function acceptPhotoDrag(e: DragLike): void {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

/** Read the dragged photo id on `drop`. Null when the payload is something else entirely. */
export function readPhotoDrag(e: { dataTransfer: DataTransfer }): string | null {
  return e.dataTransfer.getData(PHOTO_DND_MIME) || null;
}

/**
 * Did the pointer genuinely LEAVE this target, or merely cross onto one of its own children?
 *
 * `dragleave` fires on the parent whenever the pointer moves into a descendant, so a naive
 * handler clears the hover state the instant the pointer reaches the photo, the badge or the
 * gradient inside a frame — which is why the "Replace" affordance flickered while hovering a
 * filled slot. Checking containment answers the question the handler was actually asking.
 */
export function leftDropTarget(e: LeaveLike): boolean {
  const related = e.relatedTarget;
  return !(related instanceof Node) || !e.currentTarget.contains(related);
}
