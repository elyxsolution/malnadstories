/**
 * EDITING BOUNDS — the seam between the EDITING layer and the RENDER layer.
 *
 * The renderer (canvas page, preview, flipbook, review, PDF) clips every page to its trim box:
 * anything outside the page does not print. The EDITOR does not stop a gesture at the trim edge —
 * an element can be dragged out onto a pasteboard margin around the page, the way it works in
 * every real layout tool, so a photo can be pushed off the edge deliberately (full-bleed crops,
 * a sticker half-hanging off a corner) instead of being pinned inside.
 *
 * ── WHY THERE IS NO LONGER A SEPARATE "TRAVEL" ENVELOPE ───────────────────────────────────
 *
 * There used to be two boxes: a generous uniform `EDIT_BOUNDS` a gesture could roam, and a
 * tighter `commitBounds` the element had to LAND inside. The gap between them is exactly where
 * the "objects snap back when released near the page edge" bug lived: an overlay dragged past the
 * left edge followed the pointer to x = −0.3, then teleported to x = 0 the instant the pointer
 * came up. Nothing about that reads as a rule — it reads as the page reclaiming the object.
 *
 * So the gesture now travels inside the SAME box it may land in (`travelBounds === commitBounds`).
 * An element goes exactly where you put it and stays there. Release is a no-op; there is no
 * settle, no jump, and `clampRect` on release survives only as a defensive backstop.
 *
 * KEEP IN SYNC WITH `src/lib/validations.ts` — these bounds ARE the persisted contract:
 *   OverlaySchema      x,y ∈ [0, 1]      w,h ∈ (0, 1]
 *   TextElementSchema  x,y ∈ [-0.5, 1]   w,h ∈ (0, 1]
 *   QrElementSchema    x,y ∈ [0, 1]      w,h ∈ (0, 1]
 *   StickerElementSch. x,y ∈ [-0.5, 1]   w,h ∈ (0, 1]
 *
 * Note that x ≤ 1 with w ≤ 1 already lets ANY element hang off the right/bottom edge (x = 0.9,
 * w = 0.3 lands its far edge at 1.2). Text and stickers may additionally sit off the left/top.
 * Overlays and QR codes may not — their stored contract starts at 0 — so their left/top travel
 * stops flush with the trim rather than pretending to go further and snapping back. Widening
 * that is a two-line change to `OverlaySchema`/`QrElementSchema`, deliberately NOT made here.
 */

import type { Rect } from './model';

/** The element kinds that live on a page or cover and can be moved. */
export type EditableKind = 'overlay' | 'text' | 'qr' | 'sticker';

export type Bounds = {
  /** Smallest allowed `x` / `y` (the element's top-left, normalized to the page box). */
  minX: number;
  minY: number;
  /** Largest allowed `x` / `y`. */
  maxX: number;
  maxY: number;
};

/**
 * The furthest outside the page any element's origin may sit, as a fraction of the page box.
 * Half a page is enough to park an element almost entirely off-canvas.
 */
export const EDIT_MARGIN = 0.5;

/**
 * How much of the page box the pasteboard occupies VISUALLY — the working margin drawn around
 * the page where an off-page element's selection chrome remains visible and grabbable.
 * Expressed as a percentage of the page width so it scales with zoom.
 */
export const PASTEBOARD_PCT = 6;

const COMMIT_BOUNDS: Record<EditableKind, Bounds> = {
  overlay: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  qr: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  text: { minX: -EDIT_MARGIN, minY: -EDIT_MARGIN, maxX: 1, maxY: 1 },
  sticker: { minX: -EDIT_MARGIN, minY: -EDIT_MARGIN, maxX: 1, maxY: 1 },
};

/** Where an element of this kind is allowed to come to rest (mirrors the persisted schema). */
export function commitBounds(kind: EditableKind): Bounds {
  return COMMIT_BOUNDS[kind];
}

/**
 * How far a GESTURE on this kind may travel.
 *
 * Identical to `commitBounds` by construction, and that identity is the fix rather than an
 * oversight: a gesture that can only reach places the element may stay can never end in a jump.
 * The function exists (instead of callers using `commitBounds` twice) so the two ideas stay
 * nameable — if a kind ever earns real overshoot, this is the one place it is expressed.
 */
export function travelBounds(kind: EditableKind): Bounds {
  return COMMIT_BOUNDS[kind];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Clamp a rect's origin into `bounds`; size is left alone (the schemas cap w/h at 1 separately). */
export function clampRect(rect: Rect, bounds: Bounds): Rect {
  const x = clamp(rect.x, bounds.minX, bounds.maxX);
  const y = clamp(rect.y, bounds.minY, bounds.maxY);
  return x === rect.x && y === rect.y ? rect : { ...rect, x, y };
}

/** Does any part of this rect fall outside the printable page? Drives the "will be trimmed" hint. */
export function isOffPage(rect: Rect): boolean {
  return rect.x < 0 || rect.y < 0 || rect.x + rect.w > 1 || rect.y + rect.h > 1;
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
