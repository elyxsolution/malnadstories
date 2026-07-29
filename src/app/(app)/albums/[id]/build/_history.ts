'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Tiny undo/redo state container (client-only). Wraps a single value in a
 * past/present/future stack so the Builder's `blocks` can be reverted/redone without
 * any persistence — every save still goes through the existing saveLayout. History is
 * capped so long sessions don't grow unbounded.
 */
const CAP = 60;

type History<T> = { past: T[]; present: T; future: T[] };

export function useHistoryState<T>(initial: T) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [] });

  /**
   * Depth of the open `batch()`. While > 0, `set` still applies its update but does NOT push a
   * new past entry — the entry pushed when the batch OPENED already captured the pre-batch
   * state, so the whole group collapses into one undo step.
   *
   * A ref, not state: `batch` runs synchronously and the flag must be visible to every `set`
   * inside it, including ones dispatched before React would re-render.
   */
  const batchDepth = useRef(0);

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setH((s) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(s.present) : updater;
      if (Object.is(next, s.present)) return s;
      // Inside a batch the past is left alone; the batch's opening snapshot is the undo point.
      if (batchDepth.current > 0) return { past: s.past, present: next, future: [] };
      return { past: [...s.past, s.present].slice(-CAP), present: next, future: [] };
    });
  }, []);

  /**
   * Group every mutation `fn` performs into ONE undo entry.
   *
   * This is what lets a bulk command — "remove 12 photos from their pages" — be undone by a
   * single ⌘Z rather than twelve. It works by snapshotting once up front, then suppressing
   * further pushes until the callback returns. Nesting is supported (depth-counted) so a command
   * that calls another command doesn't fragment the group.
   */
  const batch = useCallback((fn: () => void) => {
    if (batchDepth.current > 0) {
      // Already inside a batch — just run; the outermost one owns the undo entry.
      fn();
      return;
    }
    // Open the group: push the CURRENT state as the single restore point.
    setH((s) => ({ past: [...s.past, s.present].slice(-CAP), present: s.present, future: [] }));
    batchDepth.current += 1;
    try {
      fn();
    } finally {
      batchDepth.current -= 1;
    }
  }, []);

  const undo = useCallback(() => {
    setH((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future].slice(0, CAP) };
    });
  }, []);

  const redo = useCallback(() => {
    setH((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return { past: [...s.past, s.present].slice(-CAP), present: next, future: s.future.slice(1) };
    });
  }, []);

  /**
   * Apply a pure transform to EVERY snapshot — past, present and future — without pushing
   * a new entry.
   *
   * This exists for one job: the optimistic temp→real photo id swap. A remap is not a user
   * edit, so it must not become an undo step; and it must reach the history stack, or
   * pressing undo after a confirm would resurrect a temp id that no longer resolves to
   * anything. Rewriting in place keeps every snapshot referring to the same photos the
   * user actually placed.
   *
   * Identity is preserved when the transform is a no-op, so an irrelevant rewrite cannot
   * trigger a render.
   */
  const rewrite = useCallback((fn: (value: T) => T) => {
    setH((s) => {
      const past = s.past.map(fn);
      const present = fn(s.present);
      const future = s.future.map(fn);
      const unchanged =
        Object.is(present, s.present) &&
        past.every((v, i) => Object.is(v, s.past[i])) &&
        future.every((v, i) => Object.is(v, s.future[i]));
      return unchanged ? s : { past, present, future };
    });
  }, []);

  return { value: h.present, set, batch, rewrite, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
