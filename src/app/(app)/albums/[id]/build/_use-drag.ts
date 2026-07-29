'use client';

import { useCallback, useRef, useState } from 'react';
import type { BaseSlot } from './_use-builder';

/**
 * THE DRAG STORE — what is being dragged, and what it is currently over.
 *
 * WHY A STORE AT ALL. Native HTML5 drag-and-drop already moves the payload: `dataTransfer`
 * carries the photo id and the existing drop handlers read it. What it CANNOT do is tell a frame
 * "the thing hovering over you is photo X, and you currently hold photo Y" — `dataTransfer` is
 * deliberately unreadable during `dragover` for security reasons. Smart Replace needs exactly
 * that, so the drag ALSO publishes itself here.
 *
 * `dataTransfer` therefore remains the source of truth for the DROP (unchanged, so nothing about
 * existing drop behaviour changes); this store exists only so the UI can describe what is about
 * to happen. If the store were somehow empty, drops still work — they just look plainer.
 *
 * A ref plus a small piece of state: the ref is read inside drag handlers that fire many times a
 * second, while the state drives the one thing that must re-render (which frame is highlighted).
 * The hover target is stored as a KEY string rather than an object so a `dragover` firing at
 * 60fps over the same frame settles immediately instead of re-rendering every frame.
 */

/** Where a dragged photo came from — the difference between a copy and a move. */
export type DragOrigin =
  | { from: 'tray' }
  | { from: 'frame'; blockKey: string; slot?: BaseSlot; overlayId?: string };

export type DragPayload = {
  /** Photo ids being dragged. More than one when a multi-selection is dragged. */
  photoIds: string[];
  origin: DragOrigin;
};

/** Somewhere a drag can land. */
export type DropTarget =
  | { kind: 'frame'; blockKey: string; slot?: BaseSlot; overlayId?: string }
  | { kind: 'page'; blockKey: string }
  | { kind: 'tray' };

export function dropTargetKey(t: DropTarget): string {
  if (t.kind === 'tray') return 'tray';
  if (t.kind === 'page') return `page:${t.blockKey}`;
  return `frame:${t.blockKey}:${t.slot ?? ''}:${t.overlayId ?? ''}`;
}

export function useDragStore() {
  const payloadRef = useRef<DragPayload | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  /** Announce a drag. Called from `onDragStart`, alongside the existing `dataTransfer` write. */
  const begin = useCallback((payload: DragPayload) => {
    payloadRef.current = payload;
    setDragging(true);
    setHoverKey(null);
  }, []);

  /**
   * Note which target the pointer is over. Ignores repeats so a `dragover` stream over one frame
   * costs nothing after the first event.
   */
  const hover = useCallback((target: DropTarget | null) => {
    const key = target ? dropTargetKey(target) : null;
    setHoverKey((prev) => (prev === key ? prev : key));
  }, []);

  /** Clear everything — fired from `dragend` and from every drop handler. */
  const end = useCallback(() => {
    payloadRef.current = null;
    setDragging(false);
    setHoverKey(null);
  }, []);

  /** Live read for handlers that must not re-subscribe (drag events fire constantly). */
  const getPayload = useCallback(() => payloadRef.current, []);

  /** Is this specific target the current hover? Drives frame highlighting. */
  const isOver = useCallback((target: DropTarget) => hoverKey === dropTargetKey(target), [hoverKey]);

  /**
   * The photo that would land in `target` if the user dropped now — the input to the Smart
   * Replace preview. Null unless a drag is genuinely hovering this target.
   */
  const incomingPhotoId = useCallback(
    (target: DropTarget): string | null => {
      if (!dragging || hoverKey !== dropTargetKey(target)) return null;
      return payloadRef.current?.photoIds[0] ?? null;
    },
    [dragging, hoverKey],
  );

  /** True while `target` is the source of the current drag — used to fade the origin. */
  const isSource = useCallback(
    (blockKey: string, slot?: BaseSlot, overlayId?: string) => {
      const o = payloadRef.current?.origin;
      if (!o || o.from !== 'frame') return false;
      return o.blockKey === blockKey && o.slot === slot && o.overlayId === overlayId;
    },
    [],
  );

  return { dragging, begin, hover, end, getPayload, isOver, incomingPhotoId, isSource };
}

export type DragApi = ReturnType<typeof useDragStore>;
