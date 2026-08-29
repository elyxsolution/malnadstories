'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * CTRL + WHEEL OVER THE BOOK ZOOMS THE BOOK — and nowhere else zooms anything but the browser.
 *
 * ── WHY THE LISTENER IS ON THE AREA, NOT ON THE WINDOW ─────────────────────────────────────
 *
 * The obvious implementation is a global `wheel` listener that swallows ctrl+wheel. That would
 * take the browser's own zoom away from the whole application — the sidebars, the toolbars, the
 * page strip, every dialog — which is an accessibility control, not a nuisance. So the listener is
 * bound to the canvas element itself and is simply not present anywhere else: with the pointer
 * over a sidebar the event never reaches this code and the browser behaves exactly as it always
 * has. Scoping by ATTACHMENT rather than by a coordinate test also means it cannot drift out of
 * step with the layout.
 *
 * ── WHY `{ passive: false }` ───────────────────────────────────────────────────────────────
 *
 * React registers `wheel` passively at its root, so `preventDefault()` inside an `onWheel` prop is
 * ignored and the browser zooms anyway. The same reason `useCropWheel` in `_block` uses a native
 * listener. This is that pattern, one level up.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ────────────────────────────────────────────────────
 *
 * A wheel event with no ctrl/meta returns immediately: ordinary scrolling of the canvas, in both
 * axes, is completely unaffected. Nothing is prevented, nothing is stopped, and no scroll position
 * is adjusted — so the canvas cannot jump. A horizontal-only gesture (`deltaY === 0`) is left alone
 * too, since it expresses no zoom direction.
 *
 * Propagation is NOT stopped: `useCropWheel` sits deeper (on the page element, while a photo is
 * being adjusted) and stops the event itself, so image adjustment keeps the wheel and this never
 * sees it. Order of attachment decides that, not a flag.
 */
export function useCtrlWheelZoom(onZoom: (direction: 1 | -1) => void) {
  const latest = useRef(onZoom);
  latest.current = onZoom;

  // STATE, not a ref: the listener has to be attached when the element arrives, and assigning a
  // ref does not re-run an effect. Same reasoning as `useMeasuredBox`.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      // `metaKey` is how a Mac trackpad/mouse expresses the same intent; a pinch gesture also
      // arrives as ctrl+wheel, which is exactly the gesture that should zoom the book.
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.deltaY === 0) return;
      e.preventDefault(); // the browser's page zoom — suppressed HERE and only here
      latest.current(e.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [node]);

  return ref;
}
