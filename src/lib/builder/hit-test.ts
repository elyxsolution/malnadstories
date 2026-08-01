/**
 * HIT TESTING — "what is under this point, and in what order?"
 *
 * The one piece of knowledge needed to reach an object that is buried under others. A click only
 * ever reaches the TOPMOST element at a point, because that is how DOM hit testing works; to let
 * a second click reach the one below it, something has to know the whole stack. This module is
 * that something, and it is pure: geometry in, ordered ids out. No DOM, no React, no state.
 *
 * PAINT ORDER IS THE MODEL. The builder paints a spread in a fixed sequence — photo overlays,
 * then text, then QR codes, then stickers, each in array order — and nothing sets a z-index, so
 * array position IS stacking position. That is also exactly what `commands.moveLayer` reorders,
 * which is what keeps the two in agreement: the stack this module reports is the stack the Layers
 * menu manipulates.
 *
 * Base photo slots are deliberately absent. They are the page itself rather than free-floating
 * objects, they never overlap one another, and they are always beneath everything else — so they
 * are the natural fallback when nothing else is hit, not a rung on the cycle.
 */

import type { Block } from './model';

/** A point in the open-pair's normalized coordinate space (0..1 across both pages). */
export type HitPoint = { x: number; y: number };

/** One hit, addressed the same way the selection model addresses things. */
export type HitTarget =
  | { kind: 'overlay'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'qr'; id: string }
  | { kind: 'sticker'; id: string };

const contains = (r: { x: number; y: number; w: number; h: number }, p: HitPoint): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Every free element under `point`, ordered BACK TO FRONT — the same order the Layers menu shows
 * and the same order the canvas paints in.
 *
 * Rotation is intentionally ignored: an element's rect is its hit area whether or not it is
 * rotated. Testing the rotated quad would be more precise but would make the cycle depend on
 * sub-degree geometry, and a slightly generous hit area is the friendlier error here — it means a
 * rotated sticker is still reachable at the corner where you can see it.
 */
export function hitStack(block: Block, point: HitPoint): HitTarget[] {
  const out: HitTarget[] = [];
  for (const o of block.overlays) if (o.id && contains(o, point)) out.push({ kind: 'overlay', id: o.id });
  for (const t of block.texts) if (contains(t, point)) out.push({ kind: 'text', id: t.id });
  for (const q of block.qrs) if (contains(q, point)) out.push({ kind: 'qr', id: q.id });
  for (const s of block.stickers) if (contains(s, point)) out.push({ kind: 'sticker', id: s.id });
  return out;
}

/**
 * Choose what a click at `point` should select, given what is already selected.
 *
 * • `alt` held        → step DOWN one level from the current selection (the explicit escape hatch)
 * • same point again  → step down as well, so repeated clicks walk the stack and wrap around
 * • anything else     → the topmost element, i.e. ordinary clicking, unchanged
 *
 * Returns null when the point is empty, which the caller reads as "fall through to the base slot
 * or deselect". Stepping is deliberately downward-only and wrapping: it is a cycle, so you can
 * always get back to where you started by clicking again rather than by knowing a second gesture.
 */
export function resolveHit(
  stack: readonly HitTarget[],
  current: HitTarget | null,
  opts: { alt: boolean; repeat: boolean },
): HitTarget | null {
  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];
  if (!opts.alt && !opts.repeat) return top;

  const i = current ? stack.findIndex((h) => h.kind === current.kind && h.id === current.id) : -1;
  // Nothing in this stack is selected yet — a modifier can't step down from nowhere, so start
  // at the top, exactly as a plain click would.
  if (i < 0) return top;
  // One step toward the back, wrapping around to the front.
  return stack[(i - 1 + stack.length) % stack.length];
}

/** Two clicks count as "the same place" within this distance (fraction of the pair's width). */
export const REPEAT_CLICK_RADIUS = 0.012;

export function isSamePoint(a: HitPoint | null, b: HitPoint): boolean {
  return !!a && Math.abs(a.x - b.x) <= REPEAT_CLICK_RADIUS && Math.abs(a.y - b.y) <= REPEAT_CLICK_RADIUS;
}
