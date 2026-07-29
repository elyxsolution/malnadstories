'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import {
  EMPTY_SELECTION,
  extendRange,
  isSelected,
  primaryTarget,
  pruneSelection,
  remapSelectionPhotoId,
  selectOnly,
  toggleTarget,
  type SelectionState,
  type SelectionTarget,
} from './_selection-model';

/**
 * THE SELECTION STORE — one piece of state for everything the user is acting on.
 *
 * Desktop selection semantics, from a single `pick()` entry point: a plain click replaces,
 * Ctrl/Cmd-click toggles, Shift-click extends a range within the caller's VISUAL order. Every
 * surface (tray, canvas, navigator) funnels through the same function, so the three behave
 * identically without agreeing on anything beyond a target.
 *
 * SURVIVAL IS THE HARD PART, and it is handled here rather than by asking every mutation site to
 * remember:
 *   • DELETION / UNDO / REDO — a prune pass runs whenever blocks or photos change and drops
 *     targets that no longer exist. Identity is preserved when nothing was dropped, so a prune
 *     that finds nothing cannot cause a render.
 *   • OPTIMISTIC ID REMAP — `remapPhotoId` rewrites photo targets in place when an upload
 *     confirms, so a photo selected while uploading stays selected once it becomes real.
 *   • PAGE NAVIGATION — targets carry their own `blockKey`, so changing page changes nothing.
 */
export function useSelection({ blocks, photos }: { blocks: Block[]; photos: Photo[] }) {
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);

  /**
   * Does this target still exist? The predicate behind survival — an id that no longer resolves
   * is silently dropped from the selection.
   */
  const exists = useCallback(
    (t: SelectionTarget): boolean => {
      if (t.kind === 'photo') return photos.some((p) => p.id === t.photoId);
      const block = blocks.find((b) => b.key === t.blockKey);
      if (!block) return false;
      switch (t.kind) {
        case 'base':
          // A base slot exists as long as its page does — it may legitimately be empty.
          return true;
        case 'overlay':
          return block.overlays.some((o) => o.id === t.id);
        case 'text':
          return block.texts.some((x) => x.id === t.id);
        case 'qr':
          return block.qrs.some((x) => x.id === t.id);
        case 'sticker':
          return block.stickers.some((x) => x.id === t.id);
      }
    },
    [blocks, photos],
  );

  // Prune whenever the world changes. `pruneSelection` returns the same object when nothing was
  // dropped, so this settles immediately and never loops.
  useEffect(() => {
    setSelection((prev) => pruneSelection(prev, exists));
  }, [exists]);

  /**
   * THE single selection entry point. `ordered` is the caller's visual order, needed only for
   * shift-range; a caller with no meaningful order can omit it.
   */
  const pick = useCallback(
    (t: SelectionTarget, mods: { meta?: boolean; shift?: boolean } = {}, ordered?: readonly SelectionTarget[]) => {
      setSelection((prev) => {
        if (mods.shift && ordered) return extendRange(prev, t, ordered);
        if (mods.meta) return toggleTarget(prev, t);
        return selectOnly(t);
      });
    },
    [],
  );

  const clear = useCallback(() => setSelection(EMPTY_SELECTION), []);

  /** Called by the photo pipeline when an optimistic id becomes real. */
  const remapPhotoId = useCallback((fromId: string, toId: string) => {
    setSelection((prev) => remapSelectionPhotoId(prev, fromId, toId));
  }, []);

  const has = useCallback((t: SelectionTarget) => isSelected(selection, t), [selection]);
  const primary = useMemo(() => primaryTarget(selection), [selection]);

  // Stable read for callbacks that must not re-subscribe per render (the shortcut manager).
  const ref = useRef(selection);
  useEffect(() => {
    ref.current = selection;
  }, [selection]);

  return { selection, setSelection, pick, clear, has, primary, remapPhotoId, getSelection: useCallback(() => ref.current, []) };
}

export type SelectionApi = ReturnType<typeof useSelection>;
