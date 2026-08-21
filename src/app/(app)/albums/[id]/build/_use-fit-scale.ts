'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * FIT THE ALBUM TO THE WORKSPACE — a DISPLAY decision, and nothing more.
 *
 * The editor is a fixed viewport: toolbar, rail, canvas, page strip, all inside one
 * `h-[100dvh]` column. The album inside it was sized as a percentage of the canvas WIDTH, so on
 * any ordinary laptop a spread was taller than the space it had and the canvas scrolled — you
 * could not see a whole page without moving the view, which is the one thing a page-layout tool
 * has to be able to show you.
 *
 * ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────────────────────
 *
 * Nothing about the album. Page dimensions, the pair aspect, overlay rects, text sizes, the
 * cover spread, `edit_config`, the print CSS and the PDF are all unchanged and unaware of this.
 * Every coordinate in the model stays normalized to the page, exactly as before; all that changes
 * is how many CSS pixels one page is drawn at. That is the difference between fitting a view and
 * resizing a product, and it is why this lives in the viewport layer rather than in the model.
 *
 * Editor zoom composes on top: `fit × zoomPct`. 100% therefore means "the whole spread, as large
 * as it will go", and zooming past it scrolls the canvas deliberately — which is what a zoom
 * control is for.
 */

/**
 * The content box of an element, tracked live. Excludes padding and borders.
 *
 * The node is STATE rather than a ref because the observer has to be (re)attached when the
 * element arrives, and a ref assignment does not re-run an effect. It is also seeded synchronously
 * from the first measurement, so the very first paint is already fitted instead of flashing at
 * the fallback size.
 */
export function useMeasuredBox<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    setBox({ w: node.clientWidth, h: node.clientHeight });
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return { ref, box };
}

export type FitOptions = {
  /** The drawn block's width / height — the open pair, or the whole cover spread. */
  aspect: number;
  /**
   * Padding drawn AROUND the block as a fraction of its own width, on all four sides (the page
   * canvas's pasteboard). CSS percentage padding resolves against width on every axis, which is
   * why one number describes both.
   */
  padFrac?: number;
  /** Fixed vertical furniture stacked with the block — a caption, a per-spread action row. */
  chromePx?: number;
  /** An upper bound on how large the block may be drawn, for taste on very wide displays. */
  maxPx?: number;
};

/**
 * The width (px) at which the block, its pasteboard and its furniture all fit inside `box`.
 *
 * Returns null until the workspace has been measured, so a caller can fall back to its previous
 * percentage sizing for exactly one frame rather than rendering at zero.
 */
export function fitBlockWidth(box: { w: number; h: number }, opts: FitOptions): number | null {
  if (box.w <= 0 || box.h <= 0 || opts.aspect <= 0) return null;
  const pad = opts.padFrac ?? 0;
  // Total drawn height, expressed as a multiple of the block's own width.
  const heightPerWidth = 2 * pad + (1 - 2 * pad) / opts.aspect;
  const byHeight = (box.h - (opts.chromePx ?? 0)) / heightPerWidth;
  const limit = Math.min(box.w, byHeight, opts.maxPx ?? Number.POSITIVE_INFINITY);
  // A floor keeps a transiently tiny container (a collapsing panel mid-animation) from
  // collapsing the album to nothing.
  return Math.max(200, limit);
}
