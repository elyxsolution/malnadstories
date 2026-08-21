'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * ONE UNDO STACK OVER TWO STATE CONTAINERS.
 *
 * The builder's editable state genuinely lives in two places, and neither can absorb the other:
 * the layout is a history-backed `Block[]` (`useBlocks`), while an image adjustment lives on
 * `photos.edit_config` because a photo carries its own crop everywhere it is drawn
 * (`usePhotoEditHistory`). Two stacks, however, cannot answer the only question ⌘Z asks — "what
 * did I do LAST?" — because neither of them knows about the other's edits.
 *
 * So this keeps the one thing they are both missing: the ORDER. It stores no state of its own
 * beyond a list of lane names, undoes into whichever lane owns the most recent entry, and moves
 * that name to the redo list. Each lane still owns its own snapshots, its own coalescing and its
 * own persistence; this only decides whose turn it is.
 *
 * Entries arrive by explicit `push`, from the same code path that creates the lane's own entry —
 * `useBlocks`' mutation gate and `usePhotoEditHistory.commit`. Deriving them by watching stack
 * depths would work too, but it would have to distinguish "the user edited" from "we just undid",
 * and an explicit push at the one place that knows is both simpler and honest.
 *
 * The stacks live in REFS with a version counter driving re-render, rather than in `useState`.
 * That is deliberate: undoing has to read the top of the stack AND call into a lane, and doing
 * that inside a `setState` updater would put a side effect somewhere React is allowed to run
 * twice. Refs keep the read and the call in one plain function, and keep `undo`/`redo` stable
 * for the command registry and the keyboard layer that memoize on them.
 */

const CAP = 120;

export type HistoryLane = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
};

export function useEditHistory<K extends string>(lanes: Record<K, HistoryLane>) {
  const past = useRef<K[]>([]);
  const future = useRef<K[]>([]);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((v) => v + 1), []);

  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  /** A lane just recorded a new entry. Called by the lane's own mutation gate, never inferred. */
  const push = useCallback(
    (lane: K) => {
      past.current = [...past.current, lane].slice(-CAP);
      future.current = [];
      rerender();
    },
    [rerender],
  );

  const undo = useCallback(() => {
    const lane = past.current[past.current.length - 1];
    if (lane === undefined) return;
    past.current = past.current.slice(0, -1);
    future.current = [lane, ...future.current].slice(0, CAP);
    lanesRef.current[lane].undo();
    rerender();
  }, [rerender]);

  const redo = useCallback(() => {
    const lane = future.current[0];
    if (lane === undefined) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, lane].slice(-CAP);
    lanesRef.current[lane].redo();
    rerender();
  }, [rerender]);

  return { push, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

export type EditHistory<K extends string = string> = ReturnType<typeof useEditHistory<K>>;
