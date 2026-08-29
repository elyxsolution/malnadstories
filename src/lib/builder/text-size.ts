/**
 * THE FONT-SIZE AUTHORITY for every text element (pages AND cover) — pure, no I/O, no React.
 *
 * `TextElement.size` is the ONLY representation of how big a piece of text is. It is authored in
 * px at the reference open-pair width (`REF_PAIR_W`) and rendered through `textFontSize`, so the
 * canvas, the preview, the flipbook and both PDFs derive their `font-size` from this one number.
 * There is deliberately no CSS `transform: scale` anywhere in the text path: a scaled box would
 * make the model and the render disagree the moment either was read back.
 *
 * Three affordances change that number, and all three land here so they cannot drift:
 *
 *   the numeric field   → `parseTextSize` → `clampTextSize`
 *   the ▲ / ▼ steppers  → `stepTextSize`  → `clampTextSize`
 *   a corner drag       → `fontScaleForResize` → `resizedTextSize` → `clampTextSize`
 *
 * ── WHY THE BOUNDS LIVE HERE ─────────────────────────────────────────────────────────────────
 *
 * They used to live in three places that disagreed: the toolbar input clamped 10–160, the
 * inspector slider ran 10–160, and `TextElementSchema` accepted 6–220. A UI maximum that is not
 * the model's maximum is a value the user can be shown and then silently refused, so the schema
 * now imports these constants rather than restating them.
 *
 * `MAX_TEXT_SIZE` is a SAFETY CEILING, not a design opinion. A page is 1000 units wide by
 * definition, so 1000 already spans the full open pair; the ceiling sits well above that so a
 * poster-sized word is expressible, while still bounding what a forged client can store.
 */
import { clampRect, EDIT_BOUNDS } from './edit-bounds';
import type { Rect } from './model';

/** Below this a text element is a hairline nobody can select — the floor exists to keep it usable. */
export const MIN_TEXT_SIZE = 4;
/** Far above a full-page word (a page is REF_PAIR_W = 1000 units wide); a bound, not a style rule. */
export const MAX_TEXT_SIZE = 2000;
/** One px per press — the smallest change worth a click, matching the old slider's step. */
export const TEXT_SIZE_STEP = 1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Bring any number into the storable range. Sizes are kept as integers: the field, the steppers
 * and the resize maths all display a rounded value, and rounding at the single point of entry is
 * what stops "the input says 75, the model holds 74.6".
 */
export function clampTextSize(v: number): number {
  if (!Number.isFinite(v)) return MIN_TEXT_SIZE;
  return clamp(Math.round(v), MIN_TEXT_SIZE, MAX_TEXT_SIZE);
}

/**
 * Read what the user actually typed. Returns `null` for anything that is not a number — an empty
 * field, a lone minus sign, "12px" — so the caller can leave the element alone instead of writing
 * a fabricated size.
 *
 * NOTHING IS CLAMPED WHILE TYPING. The old control clamped on every keystroke, which is why a
 * value could not be typed at all: reaching 180 means passing through "1", and "1" clamped to the
 * minimum of 10, rewriting the field under the caret. Clamping belongs at COMMIT.
 */
export function parseTextSize(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * WHAT A COMMITTED FIELD IS WORTH — the exact value the input must then display, and the exact
 * value the model must then hold. They are the same number by construction, which is the property
 * that makes "the input says 75 but the text is still 32" unrepresentable.
 *
 * Unparseable input (empty, "px", a stray minus) is NOT an instruction to resize to something
 * arbitrary — it means the edit said nothing, so the current size is returned and the field snaps
 * back to it.
 */
export function commitTextSize(raw: string, current: number): number {
  const parsed = parseTextSize(raw);
  return parsed === null ? clampTextSize(current) : clampTextSize(parsed);
}

/** One stepper press. Steps from the CURRENT size, so the arrows and the field can never disagree. */
export function stepTextSize(current: number, direction: 1 | -1, step: number = TEXT_SIZE_STEP): number {
  return clampTextSize(current + direction * step);
}

// ── drag-resize → font size ──────────────────────────────────────────────────────────────────

/** Which edges the handle being dragged owns — `Movable`'s own `ex`/`ey` vocabulary. */
export type ResizeEdges = { ex: -1 | 0 | 1; ey: -1 | 0 | 1 };

/**
 * How much a resize gesture should scale the TEXT, or `null` when it should scale nothing.
 *
 * CORNER HANDLES SCALE, SIDE HANDLES REFLOW — the convention every layout tool uses, and the only
 * one that keeps both capabilities. A corner owns both axes, so the box grows in both directions
 * and the type can grow with it. A side handle owns one axis: making the box wider is how you
 * change where the words wrap, and growing the type on that gesture would remove the only way to
 * control wrapping while also overflowing the box's untouched other dimension (`TextContent`
 * clips at `overflow: hidden`).
 *
 * The factor is the GEOMETRIC MEAN of the two axis ratios. It responds to both axes, is symmetric
 * (widening by 2× then halving returns exactly 1), and — unlike taking one axis — cannot report
 * "no change" for a drag that plainly resized the box.
 */
export function fontScaleForResize(start: Rect, next: Rect, edges: ResizeEdges): number | null {
  if (edges.ex === 0 || edges.ey === 0) return null;
  if (!(start.w > 0) || !(start.h > 0)) return null;
  const s = Math.sqrt((next.w / start.w) * (next.h / start.h));
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * The font size a resize gesture has reached.
 *
 * `startSize` is the size the element had when the gesture BEGAN, and it is the reason repeated
 * resizes stay stable. Deriving from the element's live size would multiply an already-scaled
 * value on every pointer-move event — the cumulative-scaling bug — and would also make the drag
 * irreversible once a bound was hit, because pulling back would then shrink from the clamped
 * value instead of returning to the original. Every frame recomputes from the same source.
 */
export function resizedTextSize(startSize: number, start: Rect, next: Rect, edges: ResizeEdges): number | null {
  const s = fontScaleForResize(start, next, edges);
  return s === null ? null : clampTextSize(startSize * s);
}

// ── font size → bounding box ─────────────────────────────────────────────────────────────────

/**
 * The box a text element needs after its size changed by a means OTHER than a drag.
 *
 * `TextContent` clips (`overflow: hidden`) and the box is stored, not measured, so growing the
 * type without growing the box would hide the very characters that just got bigger — a stale
 * bounding box, and resize handles left describing a rectangle the text no longer occupies. The
 * box therefore scales by the SAME factor as the type, about the element's own centre, so the
 * wrap is preserved (identical characters per line) and the text does not walk across the page.
 *
 * A drag does NOT use this: there the pointer already decided the box, and re-deriving it would
 * fight the gesture.
 */
export function boxForTextSize<T extends Rect & { size: number }>(el: T, nextSize: number): Rect {
  if (!(el.size > 0) || !Number.isFinite(nextSize) || nextSize <= 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const s = nextSize / el.size;
  // w/h ∈ (0,1] is the persisted contract (see edit-bounds + the Zod schemas).
  const w = clamp(el.w * s, 0.001, 1);
  const h = clamp(el.h * s, 0.001, 1);
  return clampRect({ x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h }, EDIT_BOUNDS);
}

/**
 * THE ONE PATCH a size change produces — size plus the box that keeps it visible. Every non-drag
 * affordance (field, steppers, and any future one) goes through this, so they cannot diverge.
 */
export function textSizePatch<T extends Rect & { size: number }>(el: T, nextSize: number): Rect & { size: number } {
  const size = clampTextSize(nextSize);
  return { ...boxForTextSize(el, size), size };
}
