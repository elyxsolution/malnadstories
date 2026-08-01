/**
 * EDITING BOUNDS — the seam between the EDITING layer and the RENDER layer.
 *
 * The renderer (canvas page, preview, flipbook, review, PDF) clips every page to its trim box:
 * anything outside the page does not print, and that has not changed. What changed is that the
 * EDITOR no longer stops a gesture at the trim edge. An element can now be dragged out onto a
 * pasteboard margin around the page — the way it works in every real layout tool — so a photo
 * can be pushed off the edge deliberately (full-bleed crops, sticker half-hanging off a corner)
 * instead of being pinned inside.
 *
 * Two different boxes make that safe:
 *
 *   • EDIT_BOUNDS   — how far a gesture may travel. Generous and uniform, so dragging feels
 *                     unbounded and the pasteboard is real space, not a tease.
 *   • commitBounds  — where the element is allowed to LAND. This MIRRORS the persisted contract
 *                     in `src/lib/validations.ts` exactly, per element kind, so a saved layout
 *                     always passes server validation. No server schema was changed to add this.
 *
 * KEEP IN SYNC WITH `src/lib/validations.ts`:
 *   OverlaySchema      x,y ∈ [0, 1]      w,h ∈ (0, 1]
 *   TextElementSchema  x,y ∈ [-0.5, 1]   w,h ∈ (0, 1]
 *   QrElementSchema    x,y ∈ [0, 1]      w,h ∈ (0, 1]
 *   StickerElementSch. x,y ∈ [-0.5, 1]   w,h ∈ (0, 1]
 *
 * Note that x ≤ 1 with w ≤ 1 already lets ANY element hang off the right/bottom edge (x = 0.9,
 * w = 0.3 lands its far edge at 1.2). Text and stickers may additionally sit off the left/top
 * (negative x/y). Overlays and QR codes may travel there during a gesture but settle flush with
 * the edge on release, because that is the furthest the stored contract accepts.
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
 * The pasteboard: how far outside the page a gesture may travel, as a fraction of the page box.
 * Half a page in every direction is enough to park an element completely off-canvas without the
 * scroll container ever needing to grow.
 */
export const EDIT_MARGIN = 0.5;

/** Travel allowance during a drag/resize. Uniform across kinds — the feel should not vary. */
export const EDIT_BOUNDS: Bounds = { minX: -EDIT_MARGIN, minY: -EDIT_MARGIN, maxX: 1, maxY: 1 };

/**
 * How much of the page box the pasteboard occupies VISUALLY. Smaller than `EDIT_MARGIN`: the
 * gesture may travel further than the visible margin, the canvas just scrolls/clips beyond it.
 * Expressed as a percentage of the page width so it scales with zoom.
 */
export const PASTEBOARD_PCT = 6;

const COMMIT_BOUNDS: Record<EditableKind, Bounds> = {
  overlay: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  qr: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  text: { minX: -0.5, minY: -0.5, maxX: 1, maxY: 1 },
  sticker: { minX: -0.5, minY: -0.5, maxX: 1, maxY: 1 },
};

/** Where an element of this kind is allowed to come to rest (mirrors the persisted schema). */
export function commitBounds(kind: EditableKind): Bounds {
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
