/**
 * THE STICKER BOX IS THE STICKER.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 *
 * A placed sticker's selection outline and its eight resize handles were dramatically larger than
 * the artwork inside them, with wide empty margins. The cause is geometric and total, not a
 * property of any one asset:
 *
 *   `makeSticker` creates a PIXEL-SQUARE box — `h = w × containerAspect` — whatever shape the
 *   artwork is, and `StickerContent` draws that artwork `object-fit: contain` inside it.
 *
 * `contain` letterboxes. So a 3:1 banner sticker in a square box renders with a third of the box
 * as artwork and two thirds as transparency, and `Movable` — which correctly outlines the ELEMENT
 * — outlines the whole box. The wider the artwork's aspect diverges from square, the worse it
 * looks, which is why it reads as "some stickers have huge padding".
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────────────────────
 *
 * Derive the box from the artwork's REAL geometry: `stickerFitBox` returns the rectangle the
 * artwork is ALREADY being drawn in — the contain-fitted rect — and the caller stores that as the
 * element's box.
 *
 * Two consequences worth being explicit about, because they are what make this a fix rather than
 * a fudge:
 *
 *   • THE VISIBLE STICKER DOES NOT CHANGE SIZE OR MOVE. The new box IS the rendered rect, so the
 *     artwork occupies exactly the pixels it occupied before; only the empty margin is removed.
 *     Once the box matches the aspect, `contain` and a plain fill coincide, so nothing distorts.
 *   • IT IS NOT AN OFFSET. Nothing here is a constant, a fudge factor or a per-asset tweak: the
 *     numbers come from the image's own `naturalWidth`/`naturalHeight` and the container's aspect.
 *     Any shape works, because the shape is an input.
 *
 * What this deliberately does NOT do is trim transparent padding baked INTO an asset — pixels the
 * artwork itself declares as its own. That needs per-pixel analysis of admin artwork and belongs
 * upstream, in the sticker catalog, not in the builder. See the note in the final report.
 *
 * PURE — no React, no DOM, no I/O.
 */
import type { Rect } from './model';

/**
 * How close two aspects must be before the box counts as already tight.
 *
 * It exists to stop a fit from firing forever on floating-point noise, and it is expressed
 * against the ASPECT (a ratio) rather than the box, so it means the same thing for a small
 * sticker and a large one.
 */
export const STICKER_FIT_EPSILON = 0.005;

/**
 * The box that hugs the artwork, or `null` when the current one already does.
 *
 * `naturalAspect` is the image's `naturalWidth / naturalHeight`; `containerAspect` is the host
 * surface's width / height in pixels (the open pair, or one cover face) — needed because the
 * element's box is normalized to that surface, so a "square" box is only square in pixels when
 * `h = w × containerAspect`.
 *
 * The CENTRE is held: shrinking the box around the artwork must not move the picture.
 */
export function stickerFitBox(
  el: Rect,
  naturalAspect: number,
  containerAspect: number,
): Rect | null {
  if (!(naturalAspect > 0) || !(containerAspect > 0) || !(el.w > 0) || !(el.h > 0)) return null;

  // The box's aspect as actually rendered, in pixels.
  const boxAspect = (el.w / el.h) * containerAspect;
  if (Math.abs(boxAspect - naturalAspect) <= STICKER_FIT_EPSILON * naturalAspect) return null;

  // `contain` fits to whichever axis runs out first; the other keeps its full extent.
  const w = naturalAspect > boxAspect ? el.w : (el.h * naturalAspect) / containerAspect;
  const h = naturalAspect > boxAspect ? (el.w * containerAspect) / naturalAspect : el.h;
  if (!(w > 0) || !(h > 0)) return null;

  return { x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h };
}

/**
 * The `squareRatio` that keeps a RESIZE on the artwork's aspect (`h = w × ratio`).
 *
 * `Movable` already has this primitive — the QR code uses it with `containerAspect` to stay
 * pixel-square. A sticker is the same requirement with a different target ratio, so it reuses the
 * same mechanism instead of growing one: without it, dragging a corner would immediately
 * re-letterbox the artwork and the outline would come loose again on the very next gesture.
 */
export function stickerAspectRatio(naturalAspect: number, containerAspect: number): number {
  return containerAspect / naturalAspect;
}
