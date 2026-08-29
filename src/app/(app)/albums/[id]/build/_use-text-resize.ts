'use client';

import { useCallback, useRef, useState } from 'react';
import type { Rect, TextElement } from '@/lib/builder/model';
import { resizedTextSize } from '@/lib/builder/text-size';
import type { GestureContext } from './_movable';

/**
 * DRAG-RESIZING TEXT CHANGES ITS FONT SIZE — the canvas half of the one authority in
 * `lib/builder/text-size.ts`. Used by BOTH text surfaces (the page canvas and the cover), so a
 * corner drag behaves identically wherever text lives.
 *
 * What it produces is an ordinary `patchText` — `{x, y, w, h, size}` — which means the resulting
 * size flows through exactly the same state, history, autosave and serialization path as a size
 * typed into the field. There is no CSS `transform: scale` and no second representation of "how
 * big is this text"; `size` is updated, and every renderer derives its `font-size` from it.
 *
 * ── THE START SIZE IS WHY REPEATED RESIZES DO NOT DRIFT ──────────────────────────────────────
 *
 * A pointer-move arrives many times per gesture, and each one already sees the size the previous
 * one wrote. Scaling the LIVE size by the frame's ratio would therefore compound (32 → 40 → 63…
 * for one steady drag) and would make the gesture irreversible at a bound, because pulling back
 * would shrink from the clamped value rather than returning to where it started. So the size the
 * element had when the gesture began is captured once and every frame recomputes from it.
 *
 * The capture is keyed on the element AND on the gesture's own start rect, so it re-arms by
 * itself if a gesture ever ends without `end()` running.
 */
export function useTextResize(patch: (id: string, patch: Partial<TextElement>) => void) {
  const base = useRef<{ id: string; size: number; start: Rect } | null>(null);
  /**
   * WHICH ELEMENT IS BEING RESIZED RIGHT NOW — state, not a ref, because the canvas renders from
   * it: auto-fit is suppressed for the element under the pointer, and re-runs once when this
   * clears. It changes twice per gesture (start and end), never per frame.
   */
  const [resizingId, setResizingId] = useState<string | null>(null);

  const sameGesture = (id: string, start: Rect) => {
    const b = base.current;
    return !!b && b.id === id && b.start.x === start.x && b.start.y === start.y && b.start.w === start.w && b.start.h === start.h;
  };

  const onChange = useCallback(
    (el: TextElement, rect: Rect, ctx?: GestureContext) => {
      // A move, a settle-on-release, or a side handle (which reflows the words rather than
      // scaling them): the box changed and nothing else did.
      if (!ctx || ctx.mode !== 'resize') {
        base.current = null;
        patch(el.id, rect);
        return;
      }
      if (!sameGesture(el.id, ctx.start)) {
        base.current = { id: el.id, size: el.size, start: ctx.start };
        setResizingId(el.id);
      }
      const size = resizedTextSize(base.current!.size, ctx.start, rect, ctx);
      patch(el.id, size === null ? rect : { ...rect, size });
    },
    [patch],
  );

  /** The gesture is over — drop the captured start size so the next one captures its own. */
  const end = useCallback(() => {
    base.current = null;
    setResizingId(null);
  }, []);

  return { onChange, end, resizingId };
}
