'use client';

import { useCallback, useRef, useState } from 'react';
import { MAX_ZOOM, frameOverflow, type EditConfig } from '@/lib/builder/model';
import { orientedSize } from './_photo-state';
import type { Photo } from '@/lib/builder/photo';
import type { FrameRef } from './_frame-ref';

/**
 * IN-CANVAS CROP — pan and zoom a photo inside its frame, on the page, with no modal.
 *
 * WHAT THIS IS NOT. It is not a new crop implementation. `EditConfig` has carried `zoom`,
 * `offsetX` and `offsetY` since the fixed-frame crop shipped, `computeFrameLayout` already
 * renders them, and `frameOverflow` already exists for exactly one purpose: converting a drag in
 * pixels into an offset fraction. The Quick Crop modal has been doing this maths for months. All
 * that changes here is WHERE the gesture is captured — the frame on the canvas instead of a
 * dialog — so the modal, the canvas and the PDF stay pixel-identical by construction.
 *
 * THE LIVE / COMMIT CONTRACT, unchanged. Dragging patches local photo state on every pointer
 * move so the page updates on the same frame; the server write happens ONCE, on release. A
 * pointer-move-per-request version of this would have been trivial to write and would have put a
 * `savePhotoEdit` on every frame of every drag.
 *
 * NATURAL SIZE comes from `orientedSize` (the worker's dimensions, or the browser's advisory ones
 * for a photo still uploading) rather than decoding the image again — the same accessor the
 * quality engine reads, so there is one answer to "how big is this photo" in the builder.
 */

export type CropTarget = {
  /**
   * A page block's key, or a cover face as `cover:back` / `cover:front` / `cover:spine` — the
   * same key `useCover.block` mints, which is what lets ONE crop implementation serve a page
   * overlay and a back-cover overlay with no second gesture, no second renderer and no branch in
   * this file.
   */
  blockKey: string;
  /** Exactly one of these — a base slot or an overlay, the same addressing frames use. */
  slot?: 'left' | 'right' | 'image';
  overlayId?: string;
  photoId: string;
};

export const cropTargetKey = (t: CropTarget) => `${t.blockKey}:${t.slot ?? t.overlayId}`;

/** The frame a crop target names, in the vocabulary every write path speaks. */
export function cropFrameRef(t: CropTarget): FrameRef {
  return t.slot
    ? { kind: 'base', blockKey: t.blockKey, slot: t.slot, photoId: t.photoId }
    : { kind: 'overlay', blockKey: t.blockKey, overlayId: t.overlayId as string, photoId: t.photoId };
}

/** The only part of a wheel event this needs — satisfied by both React's and the DOM's. */
export type WheelLike = { deltaY: number; stopPropagation: () => void };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function useCanvasCrop({
  photoFor,
  editFor,
  onChange,
  onCommit,
}: {
  photoFor: (photoId: string) => Photo | undefined;
  /**
   * THE EDIT THIS FRAME IS CURRENTLY SHOWING — its own if it has forked, otherwise the source
   * photo's. Every gesture below starts from this rather than from `photo.edit`, which is what
   * makes adjusting one placement of an image leave every other placement of it untouched.
   */
  editFor: (target: CropTarget) => EditConfig;
  /** Live patch — the canvas re-renders from this on every move. */
  onChange: (target: CropTarget, edit: EditConfig) => void;
  /** Recorded once, on release. */
  onCommit: (target: CropTarget, edit: EditConfig) => void;
}) {
  const [target, setTarget] = useState<CropTarget | null>(null);
  const drag = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);
  /** The edit as of the last move, so release commits what is on screen without a re-read. */
  const latest = useRef<EditConfig | null>(null);

  const begin = useCallback((t: CropTarget) => setTarget(t), []);

  /** Leave crop mode, flushing anything the last gesture left uncommitted. */
  const end = useCallback(() => {
    if (target && latest.current) {
      onCommit(target, latest.current);
      latest.current = null;
    }
    drag.current = null;
    setTarget(null);
  }, [target, onCommit]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!target) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const edit = editFor(target);
      drag.current = { x: e.clientX, y: e.clientY, offX: edit.offsetX ?? 0, offY: edit.offsetY ?? 0 };
    },
    // `editFor` and `photoFor` are memoized by the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, editFor],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!target || !d) return;
      const photo = photoFor(target.photoId);
      const size = photo ? orientedSize(photo) : null;
      if (!photo || !size) return;
      const frame = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const edit = editFor(target);
      // THE existing conversion: a drag of `dx` px moves the image by `2·dx / overflow` of the
      // available pan range. Identical to Quick Crop, deliberately.
      const ov = frameOverflow(frame.width, frame.height, size.width, size.height, edit);
      if (!ov) return;
      const doffX = ov.x > 0 ? (2 * (e.clientX - d.x)) / ov.x : 0;
      const doffY = ov.y > 0 ? (2 * (e.clientY - d.y)) / ov.y : 0;
      const next: EditConfig = {
        ...edit,
        offsetX: clamp(d.offX + doffX, -1, 1),
        offsetY: clamp(d.offY + doffY, -1, 1),
      };
      latest.current = next;
      onChange(target, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, photoFor, editFor, onChange],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!target || !drag.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      drag.current = null;
      // ONE write per gesture — not one per frame.
      if (latest.current) {
        onCommit(target, latest.current);
        latest.current = null;
      }
    },
    [target, onCommit],
  );

  /**
   * Wheel zoom, committed immediately (a wheel gesture has no reliable "release").
   *
   * Typed structurally rather than as `React.WheelEvent` on purpose: React registers `wheel` as a
   * PASSIVE listener at its root, so `preventDefault()` inside a React `onWheel` does nothing and
   * the page scrolls underneath the zoom. The host therefore drives this from a native
   * `{ passive: false }` listener instead, and a native `WheelEvent` satisfies this shape exactly.
   */
  const onWheel = useCallback(
    (e: WheelLike) => {
      if (!target) return;
      e.stopPropagation();
      const edit = editFor(target);
      const next: EditConfig = { ...edit, zoom: clamp((edit.zoom ?? 1) + (e.deltaY < 0 ? 0.12 : -0.12), 1, MAX_ZOOM) };
      onChange(target, next);
      onCommit(target, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, editFor, onChange, onCommit],
  );

  /** Arrow-key nudging, so cropping is reachable without a pointer. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!target) return;
      const step = e.shiftKey ? 0.1 : 0.02;
      const edit = editFor(target);
      let next: EditConfig | null = null;
      if (e.key === 'ArrowLeft') next = { ...edit, offsetX: clamp((edit.offsetX ?? 0) - step, -1, 1) };
      else if (e.key === 'ArrowRight') next = { ...edit, offsetX: clamp((edit.offsetX ?? 0) + step, -1, 1) };
      else if (e.key === 'ArrowUp') next = { ...edit, offsetY: clamp((edit.offsetY ?? 0) - step, -1, 1) };
      else if (e.key === 'ArrowDown') next = { ...edit, offsetY: clamp((edit.offsetY ?? 0) + step, -1, 1) };
      else if (e.key === '+' || e.key === '=') next = { ...edit, zoom: clamp((edit.zoom ?? 1) + 0.15, 1, MAX_ZOOM) };
      else if (e.key === '-') next = { ...edit, zoom: clamp((edit.zoom ?? 1) - 0.15, 1, MAX_ZOOM) };
      else if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        end();
        return;
      }
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      onChange(target, next);
      onCommit(target, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, editFor, onChange, onCommit, end],
  );

  return { target, begin, end, handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown } };
}

export type CanvasCropApi = ReturnType<typeof useCanvasCrop>;
