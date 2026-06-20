'use client';

import { useCallback, useState } from 'react';

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

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setH((s) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(s.present) : updater;
      if (Object.is(next, s.present)) return s;
      return { past: [...s.past, s.present].slice(-CAP), present: next, future: [] };
    });
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

  return { value: h.present, set, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
