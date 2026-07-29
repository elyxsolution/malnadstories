'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { record } from '@/lib/perf/metrics';

/**
 * VIRTUAL GRID — renders only the rows of a CSS grid that are near the viewport.
 *
 * WHY THIS AND NOT A LIBRARY. The measured problem was DOM volume, not layout maths: a tray of
 * 2,000 photos produced ~24,000 nodes, 2,000 `ResizeObserver`s (one per `PhotoFrame`) and 2,000
 * images for the browser to decode. Windowing removes ~99% of that. A general-purpose
 * virtualizer would also bring its own measurement model, which is the one thing that must NOT
 * change here — the tray's appearance is defined by its existing Tailwind grid classes, and the
 * requirement is "no visual changes".
 *
 * So this reads the layout the CSS already produced (`grid-template-columns`, `gap`) rather than
 * imposing one. Change the grid classes and virtualization follows automatically; nothing here
 * hardcodes 3 or 4 columns.
 *
 * WHAT IT PRESERVES. Rendered tiles are ordinary DOM nodes in their natural order, so native
 * drag-and-drop, the upload badges, optimistic tiles and hover affordances all work untouched.
 * Two spacer rows (top and bottom) hold the scroll height, so the scrollbar behaves exactly as
 * it did — and `pinnedIndex` keeps the focused tile mounted so keyboard focus can never be
 * destroyed by scrolling.
 */

const ROW_OVERSCAN = 2;

export type VirtualGrid = {
  /** Attach to the grid element itself. */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Slice bounds for the caller's item array. */
  startIndex: number;
  endIndex: number;
  /** Spacer heights, in px, that stand in for the un-rendered rows. */
  padTop: number;
  padBottom: number;
  /** Columns the CSS is currently producing (for diagnostics + range maths). */
  columns: number;
  /** Row pitch in px (cell height + gap) — lets a marquee hit-test UNMOUNTED rows. */
  rowStride: number;
  gap: number;
  /** True once the grid has been measured; before that everything renders (SSR-safe). */
  measured: boolean;
  /** Call when a descendant receives focus so its row is never unmounted. */
  onItemFocus: (index: number | null) => void;
};

export function useVirtualGrid(itemCount: number, enabled = true): VirtualGrid {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLElement | Window | null>(null);

  // Geometry read back from the CSS, not assumed.
  const [layout, setLayout] = useState({ columns: 1, rowStride: 0, gap: 0, measured: false });
  const [range, setRange] = useState({ start: 0, end: itemCount });
  const pinnedRef = useRef<number | null>(null);

  /** Nearest scrollable ancestor — the element whose scrollTop actually moves this grid. */
  const findScrollParent = useCallback((el: HTMLElement): HTMLElement | Window => {
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return window;
  }, []);

  /** Read column count + row stride straight out of the computed grid. */
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    const gap = parseFloat(style.rowGap || '0') || 0;
    // Cell height comes from the first real child; the tiles are square, so width would do too,
    // but reading the child keeps this correct if the aspect ever changes.
    const firstCell = el.querySelector<HTMLElement>('[data-virtual-cell]');
    const cellHeight = firstCell?.offsetHeight ?? (el.clientWidth - gap * (columns - 1)) / columns;
    if (cellHeight <= 0) return;
    setLayout((prev) =>
      prev.columns === columns && prev.rowStride === cellHeight + gap && prev.gap === gap && prev.measured
        ? prev
        : { columns, rowStride: cellHeight + gap, gap, measured: true },
    );
  }, []);

  /** Recompute which rows are near the viewport. */
  const updateRange = useCallback(() => {
    const el = containerRef.current;
    const scroller = scrollParentRef.current;
    if (!el || !scroller || !layout.measured || layout.rowStride <= 0) return;

    const totalRows = Math.ceil(itemCount / layout.columns);
    const viewportHeight = scroller === window ? window.innerHeight : (scroller as HTMLElement).clientHeight;
    // Distance from the top of the grid to the top of the visible area.
    const gridTop = el.getBoundingClientRect().top;
    const scrollerTop = scroller === window ? 0 : (scroller as HTMLElement).getBoundingClientRect().top;
    const offset = scrollerTop - gridTop;

    const firstVisibleRow = Math.floor(offset / layout.rowStride);
    const visibleRowCount = Math.ceil(viewportHeight / layout.rowStride);

    const startRow = Math.max(0, firstVisibleRow - ROW_OVERSCAN);
    let endRow = Math.min(totalRows, firstVisibleRow + visibleRowCount + ROW_OVERSCAN);

    // Never unmount the row holding keyboard focus — doing so would drop the user's place.
    const pinned = pinnedRef.current;
    let start = startRow;
    if (pinned !== null && pinned >= 0 && pinned < itemCount) {
      const pinnedRow = Math.floor(pinned / layout.columns);
      start = Math.min(start, pinnedRow);
      endRow = Math.max(endRow, pinnedRow + 1);
    }

    setRange((prev) => {
      const next = { start: start * layout.columns, end: Math.min(itemCount, endRow * layout.columns) };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, [itemCount, layout]);

  // Measure on mount and whenever the grid resizes (breakpoint change, panel resize).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    scrollParentRef.current = findScrollParent(el);
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, findScrollParent, measure]);

  // Track scrolling. rAF-coalesced so a fast scroll costs one recomputation per frame, and
  // passive so it never blocks the scroll itself.
  useEffect(() => {
    if (!enabled || !layout.measured) return;
    const scroller = scrollParentRef.current;
    if (!scroller) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateRange();
      });
    };

    updateRange();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enabled, layout.measured, updateRange]);

  // The item count changing (an upload lands, a photo is deleted) can change the row count.
  useEffect(() => {
    if (enabled && layout.measured) updateRange();
  }, [enabled, itemCount, layout.measured, updateRange]);

  const onItemFocus = useCallback(
    (index: number | null) => {
      pinnedRef.current = index;
      if (index !== null) updateRange();
    },
    [updateRange],
  );

  // Before measurement — and when disabled — render everything, so SSR and the first paint are
  // identical to the un-virtualized behaviour.
  if (!enabled || !layout.measured || layout.rowStride <= 0) {
    return {
      containerRef,
      startIndex: 0,
      endIndex: itemCount,
      padTop: 0,
      padBottom: 0,
      columns: layout.columns,
      rowStride: layout.rowStride,
      gap: layout.gap,
      measured: false,
      onItemFocus,
    };
  }

  const totalRows = Math.ceil(itemCount / layout.columns);
  const startRow = Math.floor(range.start / layout.columns);
  const endRow = Math.ceil(Math.min(range.end, itemCount) / layout.columns);
  const rowsBelow = Math.max(0, totalRows - endRow);

  // A spacer occupies a grid row and is itself followed by a gap, so one gap is subtracted.
  const padTop = startRow > 0 ? startRow * layout.rowStride - layout.gap : 0;
  const padBottom = rowsBelow > 0 ? rowsBelow * layout.rowStride - layout.gap : 0;

  const endIndex = Math.min(itemCount, range.end);
  if (itemCount > 0) record('virtual.ratio', ((endIndex - range.start) / itemCount) * 100);

  return {
    containerRef,
    startIndex: range.start,
    endIndex,
    padTop,
    padBottom,
    columns: layout.columns,
    rowStride: layout.rowStride,
    gap: layout.gap,
    measured: true,
    onItemFocus,
  };
}
