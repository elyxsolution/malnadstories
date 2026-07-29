'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * ANCHORING A FLOATING BAR TO SOMETHING ON THE CANVAS.
 *
 * The context bar has to sit next to whatever is selected, and everything about the canvas
 * conspires against that: it lives in a scrolling container, its zoom is a percentage width, the
 * window resizes, and the selected element is addressed in NORMALIZED coordinates (0..1 of the
 * open pair) rather than pixels.
 *
 * The trick that makes this cheap is that we never measure the ELEMENT. The page box is the only
 * thing measured; an element's viewport rect is then pure arithmetic against its normalized rect,
 * which the builder already has in state. So selecting a different overlay costs no DOM work at
 * all, and one `getBoundingClientRect` per scroll frame covers every possible selection.
 *
 * COST CONTROL. Listeners are passive and capture-phase (the canvas scrolls, not the window, so
 * bubble-phase `scroll` would never fire), and every event coalesces into ONE `requestAnimationFrame`
 * measurement. A `ResizeObserver` on the page catches zoom changes and layout reflow without
 * polling. Nothing runs at all while `rect` is null — i.e. whenever nothing is selected.
 */

export type Anchor = { left: number; top: number; width: number; height: number };

/** A normalized box on the open pair — the same shape overlays, text, QR and stickers all use. */
export type NormRect = { x: number; y: number; w: number; h: number };

/** The whole page, for when the bar anchors to the spread rather than to an element on it. */
export const FULL_PAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

export function useAnchorRect(pageRef: RefObject<HTMLElement | null>, rect: NormRect | null): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const measure = useCallback(() => {
    const el = pageRef.current;
    if (!el || !rect) {
      setAnchor(null);
      return;
    }
    const box = el.getBoundingClientRect();
    const next: Anchor = {
      left: box.left + rect.x * box.width,
      top: box.top + rect.y * box.height,
      width: rect.w * box.width,
      height: rect.h * box.height,
    };
    // Identity is preserved when nothing moved, so a scroll that doesn't change the anchor (the
    // canvas is already at an edge) costs one comparison instead of a re-render.
    setAnchor((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
        ? prev
        : next,
    );
  }, [pageRef, rect]);

  useEffect(() => {
    if (!rect) {
      setAnchor(null);
      return;
    }
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    // Capture phase: the scrolling element is the canvas container, not the window, and scroll
    // does not bubble. Passive because we never call preventDefault here.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });

    const el = pageRef.current;
    const ro = el ? new ResizeObserver(schedule) : null;
    if (el && ro) ro.observe(el);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [measure, pageRef, rect]);

  return anchor;
}
