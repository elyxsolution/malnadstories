/**
 * EDITING BOUNDS — the seam between the EDITING layer and the RENDER layer.
 *
 * The renderer (canvas page, preview, flipbook, review, PDF) clips every page to its trim box:
 * anything outside the page does not print. The EDITOR does not stop a gesture at the trim edge —
 * an element can be dragged out onto a pasteboard margin around the page, the way it works in
 * every real layout tool, so a photo can be pushed off the edge deliberately (full-bleed crops,
 * a sticker half-hanging off a corner) instead of being pinned inside.
 *
 * ── ONE BOX, FOR EVERY OBJECT ──────────────────────────────────────────────────────────────
 *
 * This file has been through two collapses, and both removed a distinction that was never real.
 *
 * First there were two boxes per element: a generous envelope a gesture could roam, and a tighter
 * one the element had to LAND inside. The gap between them was exactly where the "objects snap
 * back when released near the page edge" bug lived — an overlay followed the pointer to x = −0.3
 * and teleported to x = 0 on release. A gesture that can only reach places the element may stay
 * cannot end in a jump, so the two became one.
 *
 * Then there were four boxes, one per kind: text and stickers could sit off the left/top edge,
 * overlays and QR codes could not. That made the same gesture behave differently depending on
 * what you had grabbed, for no reason beyond the order the features were built in. The schemas
 * were widened (see `validations.ts`) and the four became one.
 *
 * What is left is a single constant. `EDIT_BOUNDS` IS the persisted contract, mirrored exactly by
 * `OverlaySchema` / `TextElementSchema` / `QrElementSchema` / `StickerElementSchema`:
 *
 *   x, y ∈ [−0.5, 1]      w, h ∈ (0, 1]
 *
 * Note that x ≤ 1 with w ≤ 1 already lets any object hang off the right/bottom edge (x = 0.9,
 * w = 0.3 ends at 1.2), so the reachable area is symmetric in effect. Only the part over the
 * paper prints — every surface clips at the trim — but the stored position is free.
 */

import type { Rect } from './model';

export type Bounds = {
  /** Smallest allowed `x` / `y` (the element's top-left, normalized to the page box). */
  minX: number;
  minY: number;
  /** Largest allowed `x` / `y`. */
  maxX: number;
  maxY: number;
};

/**
 * The furthest outside the page any object's origin may sit, as a fraction of the page box.
 * Half a page is enough to park one almost entirely off-canvas.
 */
const EDIT_MARGIN = 0.5;

/**
 * How much of the page box the pasteboard occupies VISUALLY — the working margin drawn around
 * the page where an off-page element's selection chrome remains visible and grabbable.
 * Expressed as a percentage of the page width so it scales with zoom.
 */
export const PASTEBOARD_PCT = 6;

/** Where every movable object may travel AND come to rest. One box; see the note above. */
export const EDIT_BOUNDS: Bounds = { minX: -EDIT_MARGIN, minY: -EDIT_MARGIN, maxX: 1, maxY: 1 };

/**
 * What `Movable` is handed to opt a host into off-page editing.
 *
 * `edit` (how far a gesture goes) and `commit` (where it may land) are the same box, and the
 * component still takes both because that identity is a DECISION rather than an accident — the
 * pair is what documents "release never moves anything", and it is where a future overshoot
 * behaviour would be expressed if one were ever wanted.
 */
export const PASTEBOARD_ESCAPE: { edit: Bounds; commit: Bounds } = { edit: EDIT_BOUNDS, commit: EDIT_BOUNDS };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Clamp a rect's origin into `bounds`; size is left alone (the schemas cap w/h at 1 separately). */
export function clampRect(rect: Rect, bounds: Bounds): Rect {
  const x = clamp(rect.x, bounds.minX, bounds.maxX);
  const y = clamp(rect.y, bounds.minY, bounds.maxY);
  return x === rect.x && y === rect.y ? rect : { ...rect, x, y };
}

/**
 * Is NONE of this rect over the printable page?
 *
 * Once the editing layer clips to the trim, such an element draws nothing at all — so the
 * selection chrome has to become its handle, or the object is lost on the pasteboard with no way
 * to click it. `Movable` uses this to decide when to put a grabbable ghost in the chrome layer.
 * The epsilon keeps a rect resting exactly flush with an edge on the visible side of the test.
 */
export function isFullyOffPage(rect: Rect): boolean {
  const E = 0.001;
  return rect.x + rect.w <= E || rect.y + rect.h <= E || rect.x >= 1 - E || rect.y >= 1 - E;
}
