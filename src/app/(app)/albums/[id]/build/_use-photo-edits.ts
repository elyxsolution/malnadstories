'use client';

import { useCallback, useRef, useState } from 'react';
import type { EditConfig } from '@/lib/builder/model';

/**
 * UNDO / REDO FOR IMAGE ADJUSTMENTS — the half of the builder's history that was missing.
 *
 * ── WHY IT IS A SEPARATE STACK ─────────────────────────────────────────────────────────────
 *
 * The builder's history has always wrapped `Block[]`: page order, backgrounds, overlay geometry,
 * text, stickers, QR. An image adjustment lives somewhere else entirely — on `photos.edit_config`
 * — because a photo is placed at most once, so its crop, zoom, rotation and tone belong to the
 * PHOTO rather than to the frame holding it. That is the right model (it is what lets a photo
 * look identical in the tray, the slot, the preview and the PDF), but it meant every crop, zoom,
 * rotate, flip and slider was outside `⌘Z`: moving an overlay was undoable, adjusting the picture
 * inside it was not.
 *
 * Folding photo edits into the block history would mean either snapshotting every photo on every
 * layout change or inventing a second representation of an edit inside `Block` — a duplicate
 * source of truth for exactly the thing that must not have one. So this is a second stack over
 * the real state, and `useEditHistory` orders the two so a single ⌘Z always undoes whatever the
 * user actually did last.
 *
 * ── THE LIVE / COMMIT CONTRACT ─────────────────────────────────────────────────────────────
 *
 * Every adjustment surface in the builder already works the same way: patch local state on every
 * frame so the canvas keeps up, persist ONCE on release. History hooks into exactly that seam.
 * `markLive` is called on the first live frame of a gesture and remembers what the edit was
 * BEFORE it started; `commit` is called on release and closes the entry. A surface with no live
 * phase (a rotate button, the modal editors) calls `commit` alone and passes its own `before`.
 *
 * Consecutive commits on the same photo inside `MERGE_MS` are COALESCED, because a wheel-zoom and
 * a slider drag each emit a stream of commits and a user thinks of them as one action. A gesture
 * that ends where it began collapses to nothing rather than leaving a no-op step behind.
 */

const CAP = 60;
const MERGE_MS = 800;

type Entry = { photoId: string; before: EditConfig | null; after: EditConfig | null; at: number };

/** Structural equality over two edits. They are small, flat and JSON-shaped by construction. */
function sameEdit(a: EditConfig | null | undefined, b: EditConfig | null | undefined): boolean {
  const norm = (e: EditConfig | null | undefined) => JSON.stringify(e ?? {});
  return norm(a) === norm(b);
}

export function usePhotoEditHistory(apply: (photoId: string, edit: EditConfig) => void) {
  const [past, setPast] = useState<Entry[]>([]);
  const [future, setFuture] = useState<Entry[]>([]);

  /** Per-photo "what did this look like before the gesture started". Cleared by `commit`. */
  const pending = useRef(new Map<string, EditConfig | null>());

  // Kept in a ref so `undo`/`redo` never change identity — they are wired into the command
  // registry, which memoizes on them.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  /**
   * The first live frame of a gesture. Idempotent: only the FIRST call for a photo is recorded,
   * so a hundred pointer-moves still describe one starting point.
   */
  const markLive = useCallback((photoId: string, before: EditConfig | null | undefined) => {
    if (!pending.current.has(photoId)) pending.current.set(photoId, before ?? null);
  }, []);

  /**
   * Close an adjustment. Returns true when a NEW history entry was created, so the caller can
   * order it against the layout history; a coalesced or no-op commit returns false and must not
   * add a second step to the timeline.
   */
  const commit = useCallback(
    (photoId: string, after: EditConfig | null, fallbackBefore?: EditConfig | null): boolean => {
      const before = pending.current.has(photoId) ? (pending.current.get(photoId) ?? null) : (fallbackBefore ?? null);
      pending.current.delete(photoId);
      if (sameEdit(before, after)) return false;

      const now = Date.now();
      let created = true;
      setFuture([]);
      setPast((p) => {
        const last = p[p.length - 1];
        if (last && last.photoId === photoId && now - last.at < MERGE_MS) {
          created = false;
          // Dragged back to where it started — the step no longer describes a change.
          if (sameEdit(last.before, after)) return p.slice(0, -1);
          return [...p.slice(0, -1), { ...last, after, at: now }];
        }
        return [...p, { photoId, before, after, at: now }].slice(-CAP);
      });
      return created;
    },
    [],
  );

  const undo = useCallback(() => {
    const e = past[past.length - 1];
    if (!e) return;
    // An in-flight gesture on this photo is abandoned rather than closed against a state that
    // is about to be replaced.
    pending.current.delete(e.photoId);
    applyRef.current(e.photoId, e.before ?? {});
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [e, ...f].slice(0, CAP));
  }, [past]);

  const redo = useCallback(() => {
    const e = future[0];
    if (!e) return;
    pending.current.delete(e.photoId);
    applyRef.current(e.photoId, e.after ?? {});
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { ...e, at: Date.now() }].slice(-CAP));
  }, [future]);

  return { markLive, commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export type PhotoEditHistory = ReturnType<typeof usePhotoEditHistory>;
