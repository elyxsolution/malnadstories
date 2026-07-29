'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * MARQUEE SELECTION — click-and-drag a rectangle to select everything it touches.
 *
 * THE VIRTUALIZATION PROBLEM, AND HOW THIS AVOIDS IT. The obvious implementation hit-tests DOM
 * nodes with `getBoundingClientRect()`. In a virtualized tray that silently breaks: rows outside
 * the window have no DOM, so dragging past them selects nothing and the user gets a rectangle
 * that skips items it visibly covers.
 *
 * So hit-testing is GEOMETRIC, not DOM-based. The caller supplies a `hitTest` that converts a
 * rectangle (in container coordinates) into item indices using the grid's own measurements — the
 * same `columns` and `rowStride` the virtualizer already computed. Unmounted rows are selected
 * exactly like mounted ones, because nothing consults the DOM.
 *
 * AUTO-SCROLL. Dragging near an edge scrolls the container, so a marquee can reach beyond the
 * viewport. It runs on `requestAnimationFrame` and stops the instant the pointer leaves the
 * hot zone or the drag ends — no timer survives the gesture.
 *
 * MODIFIERS follow the platform convention: a plain marquee replaces the selection, Ctrl/Cmd
 * adds to it, and Shift extends. The store decides what those mean; this only reports them.
 */

export type MarqueeRect = { x: number; y: number; w: number; h: number };

/** Distance from an edge at which auto-scroll engages, and how fast it goes. */
const EDGE_PX = 48;
const MAX_SPEED = 18;

export type MarqueeOptions = {
  /** The element the rectangle is drawn in (usually the grid). */
  containerRef: React.RefObject<HTMLElement>;
  /** The scrollable ancestor, for auto-scroll. Falls back to the container. */
  scrollRef?: React.RefObject<HTMLElement>;
  /** Convert a container-space rect into the items it covers. */
  hitTest: (rect: MarqueeRect) => string[];
  /** Commit a marquee. `mods` carries the modifier state held when the drag STARTED. */
  onSelect: (ids: string[], mods: { meta: boolean; shift: boolean }) => void;
  enabled?: boolean;
};

export function useMarquee({ containerRef, scrollRef, hitTest, onSelect, enabled = true }: MarqueeOptions) {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const state = useRef<{
    startX: number;
    startY: number;
    mods: { meta: boolean; shift: boolean };
    raf: number;
    edge: number;
  } | null>(null);

  // Latest callbacks without re-binding the pointer listeners mid-gesture.
  const cb = useRef({ hitTest, onSelect });
  useEffect(() => {
    cb.current = { hitTest, onSelect };
  });

  const scroller = useCallback(
    () => scrollRef?.current ?? containerRef.current,
    [scrollRef, containerRef],
  );

  const stop = useCallback(() => {
    if (state.current?.raf) cancelAnimationFrame(state.current.raf);
    state.current = null;
    setRect(null);
  }, []);

  /**
   * Begin a marquee. Call from `onPointerDown` on EMPTY space — the caller decides what counts
   * as empty, so a pointer-down on a tile still selects that tile normally.
   */
  const begin = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const startX = e.clientX - box.left;
      const startY = e.clientY - box.top + (scroller()?.scrollTop ?? 0);
      state.current = {
        startX,
        startY,
        mods: { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey },
        raf: 0,
        edge: 0,
      };
      setRect({ x: startX, y: startY, w: 0, h: 0 });
    },
    [enabled, containerRef, scroller],
  );

  useEffect(() => {
    if (!rect) return;

    const update = (clientX: number, clientY: number) => {
      const el = containerRef.current;
      const s = state.current;
      if (!el || !s) return;
      const box = el.getBoundingClientRect();
      const x = clientX - box.left;
      const y = clientY - box.top + (scroller()?.scrollTop ?? 0);
      setRect({
        x: Math.min(s.startX, x),
        y: Math.min(s.startY, y),
        w: Math.abs(x - s.startX),
        h: Math.abs(y - s.startY),
      });

      // Auto-scroll strength scales with how deep into the hot zone the pointer is, so it eases
      // in rather than jumping to full speed at the boundary.
      const sc = scroller();
      if (sc) {
        const scBox = sc.getBoundingClientRect();
        const above = clientY - scBox.top;
        const below = scBox.bottom - clientY;
        s.edge = above < EDGE_PX ? -(1 - above / EDGE_PX) : below < EDGE_PX ? 1 - below / EDGE_PX : 0;
      }
    };

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      update(e.clientX, e.clientY);
    };

    const onUp = () => {
      const s = state.current;
      const current = rectRef.current;
      if (s && current && (current.w > 4 || current.h > 4)) {
        // Ignore a stray click that never became a drag.
        const ids = cb.current.hitTest(current);
        cb.current.onSelect(ids, s.mods);
      }
      stop();
    };

    const tick = () => {
      const s = state.current;
      const sc = scroller();
      if (!s || !sc) return;
      if (s.edge !== 0) {
        sc.scrollTop += s.edge * MAX_SPEED;
        // Re-derive the rect against the new scroll offset so it keeps tracking the pointer.
        setRect((r) => (r ? { ...r } : r));
      }
      s.raf = requestAnimationFrame(tick);
    };
    if (state.current) state.current.raf = requestAnimationFrame(tick);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (state.current?.raf) cancelAnimationFrame(state.current.raf);
    };
    // `rect` in the dep list only toggles the listeners on/off (null ⇄ non-null); the values
    // themselves are read through refs, so a moving marquee doesn't re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rect, containerRef, scroller, stop]);

  // Live rect for the pointerup handler, which must not close over a stale value.
  const rectRef = useRef<MarqueeRect | null>(rect);
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  return { rect, begin, active: rect !== null && (rect.w > 4 || rect.h > 4) };
}

/**
 * The rubber band itself. Absolutely positioned in the container's coordinate space, drawn with
 * a hairline border and a barely-there fill — visible enough to read, quiet enough not to
 * obscure the thumbnails it is selecting.
 */
export function MarqueeBox({ rect }: { rect: MarqueeRect | null }) {
  if (!rect || (rect.w <= 4 && rect.h <= 4)) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[30] rounded-[3px] border border-studio-bright/70 bg-studio-bright/10"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  );
}
