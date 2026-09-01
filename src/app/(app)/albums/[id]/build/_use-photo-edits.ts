'use client';

import { useCallback, useRef, useState } from 'react';
import type { EditConfig } from '@/lib/builder/model';
import { frameRefKey, type FrameRef } from './_frame-ref';

/**
 * UNDO / REDO FOR IMAGE ADJUSTMENTS — the half of the builder's history that was missing.
 *
 * ── WHY IT IS A SEPARATE STACK ─────────────────────────────────────────────────────────────
 *
 * The builder's history has always wrapped `Block[]`: page order, backgrounds, overlay geometry,
 * text, stickers, QR. An image adjustment is captured as a stream of live frames with one commit
 * on release, and a wheel-zoom or a slider drag emits dozens of commits that a user thinks of as
 * ONE action — so it needs a stack that understands gestures. That is what this is, and
 * `useEditHistory` orders it against the layout stack so a single ⌘Z always undoes whatever the
 * user actually did last.
 *
 * ── WHY ENTRIES ARE KEYED BY FRAME ─────────────────────────────────────────────────────────
 *
 * They used to be keyed by PHOTO ID, which was correct while a photo could be placed once: "the
 * photo's crop" and "this frame's crop" named the same thing. With one image reusable across many
 * placements they are different things, and keying by photo would coalesce an adjustment to page 1
 * with an adjustment to the back cover into a single step that then undid the wrong one. A
 * `FrameRef` names the container; `frameRefKey` is its identity. The stack itself is unchanged —
 * it stores `before`/`after` edits and hands them back to `apply`, which is the only thing that
 * knows WHERE an edit is written (a page block, a cover face, or the `photos` row).
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

type Entry = { ref: FrameRef; key: string; before: EditConfig | null; after: EditConfig | null; at: number };

/** Structural equality over two edits. They are small, flat and JSON-shaped by construction. */
function sameEdit(a: EditConfig | null | undefined, b: EditConfig | null | undefined): boolean {
  const norm = (e: EditConfig | null | undefined) => JSON.stringify(e ?? {});
  return norm(a) === norm(b);
}

export function usePhotoEditHistory(apply: (ref: FrameRef, edit: EditConfig) => void) {
  const [past, setPast] = useState<Entry[]>([]);
  const [future, setFuture] = useState<Entry[]>([]);

  /** Per-FRAME "what did this look like before the gesture started". Cleared by `commit`. */
  const pending = useRef(new Map<string, EditConfig | null>());

  // Kept in a ref so `undo`/`redo` never change identity — they are wired into the command
  // registry, which memoizes on them.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  /**
   * The first live frame of a gesture. Idempotent: only the FIRST call for a photo is recorded,
   * so a hundred pointer-moves still describe one starting point.
   */
  const markLive = useCallback((ref: FrameRef, before: EditConfig | null | undefined) => {
    const key = frameRefKey(ref);
    if (!pending.current.has(key)) pending.current.set(key, before ?? null);
  }, []);

  /**
   * Close an adjustment. Returns true when a NEW history entry was created, so the caller can
   * order it against the layout history; a coalesced or no-op commit returns false and must not
   * add a second step to the timeline.
   */
  const commit = useCallback(
    (ref: FrameRef, after: EditConfig | null, fallbackBefore?: EditConfig | null): boolean => {
      const key = frameRefKey(ref);
      const before = pending.current.has(key) ? (pending.current.get(key) ?? null) : (fallbackBefore ?? null);
      pending.current.delete(key);
      if (sameEdit(before, after)) return false;

      const now = Date.now();
      let created = true;
      setFuture([]);
      setPast((p) => {
        const last = p[p.length - 1];
        if (last && last.key === key && now - last.at < MERGE_MS) {
          created = false;
          // Dragged back to where it started — the step no longer describes a change.
          if (sameEdit(last.before, after)) return p.slice(0, -1);
          return [...p.slice(0, -1), { ...last, after, at: now }];
        }
        return [...p, { ref, key, before, after, at: now }].slice(-CAP);
      });
      return created;
    },
    [],
  );

  const undo = useCallback(() => {
    const e = past[past.length - 1];
    if (!e) return;
    // An in-flight gesture on this FRAME is abandoned rather than closed against a state that
    // is about to be replaced.
    pending.current.delete(e.key);
    applyRef.current(e.ref, e.before ?? {});
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [e, ...f].slice(0, CAP));
  }, [past]);

  const redo = useCallback(() => {
    const e = future[0];
    if (!e) return;
    pending.current.delete(e.key);
    applyRef.current(e.ref, e.after ?? {});
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, { ...e, at: Date.now() }].slice(-CAP));
  }, [future]);

  return { markLive, commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

export type PhotoEditHistory = ReturnType<typeof usePhotoEditHistory>;
