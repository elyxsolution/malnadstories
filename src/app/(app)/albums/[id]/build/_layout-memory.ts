'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * LAYOUT MEMORY — which layouts this photographer actually reaches for.
 *
 * A working album has eight presets in the panel and a person who uses two of them. The panel
 * can't know which two; only the history of their own clicks can. So this keeps three tiny
 * facts per preset — starred, when it was last applied, how often — and lets the panel put the
 * answer at the top instead of making them hunt for it every spread.
 *
 * SCOPED TO THE DEVICE, NOT THE ALBUM. This is deliberate and the opposite of `useLabels`: a
 * label describes photos in ONE shoot, but "I always use Two Vertical" is a habit that should
 * follow the photographer into their next album. That is the whole value — the second album is
 * faster than the first.
 *
 * NO BACKEND. Preset keys are the existing `LAYOUT_PRESETS[].key` strings; nothing here is
 * persisted server-side, sent anywhere, or reachable by another user. Applying a remembered
 * layout goes through the SAME `applyPreset` path as clicking it in the grid — this module only
 * decides what to show first, never what a layout does.
 *
 * "Recently duplicated" is tracked on the same clock: duplicating a spread is how people
 * actually repeat a layout they like, so it belongs in the same memory as applying one.
 */

const KEY = 'ms-builder-layout-memory:v1';
/** Beyond this the "recent" list stops being recent. */
const RECENT_LIMIT = 6;
/** Hard cap on stored entries so a long-lived browser profile can't grow this without bound. */
const MAX_ENTRIES = 60;

type Entry = {
  /** Times this layout has been applied. */
  uses: number;
  /** Last applied (ms epoch). */
  last: number;
  /** Last used as the source of a page duplication (ms epoch), or 0. */
  duplicated: number;
};

type Store = { favourites: string[]; entries: Record<string, Entry> };

const EMPTY: Store = { favourites: [], entries: {} };

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    const favourites = Array.isArray(parsed.favourites) ? parsed.favourites.filter((v) => typeof v === 'string') : [];
    const entries: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(parsed.entries ?? {})) {
      const e = v as Partial<Entry>;
      if (typeof e?.uses !== 'number' || typeof e?.last !== 'number') continue;
      entries[k] = { uses: e.uses, last: e.last, duplicated: typeof e.duplicated === 'number' ? e.duplicated : 0 };
    }
    return { favourites, entries };
  } catch {
    return EMPTY;
  }
}

export function useLayoutMemory() {
  const [store, setStore] = useState<Store>(EMPTY);

  // Read after mount only — `localStorage` doesn't exist during SSR, and hydrating from it
  // during render would mismatch the server HTML.
  useEffect(() => setStore(read()), []);

  const persist = useCallback((next: Store) => {
    setStore(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full / private mode — the panel simply falls back to its default order */
    }
  }, []);

  /** Trim the oldest entries once the store outgrows its cap. */
  const prune = (entries: Record<string, Entry>): Record<string, Entry> => {
    const keys = Object.keys(entries);
    if (keys.length <= MAX_ENTRIES) return entries;
    const keep = keys.sort((a, b) => entries[b].last - entries[a].last).slice(0, MAX_ENTRIES);
    return Object.fromEntries(keep.map((k) => [k, entries[k]]));
  };

  /** Record that a layout was applied. Called from the ONE place that applies presets. */
  const markUsed = useCallback(
    (presetKey: string) => {
      const prev = store.entries[presetKey];
      persist({
        ...store,
        entries: prune({
          ...store.entries,
          [presetKey]: { uses: (prev?.uses ?? 0) + 1, last: Date.now(), duplicated: prev?.duplicated ?? 0 },
        }),
      });
    },
    [store, persist],
  );

  /** Record that a spread built on this layout was duplicated. */
  const markDuplicated = useCallback(
    (presetKey: string | undefined) => {
      if (!presetKey) return;
      const prev = store.entries[presetKey];
      persist({
        ...store,
        entries: prune({
          ...store.entries,
          [presetKey]: { uses: prev?.uses ?? 0, last: prev?.last ?? Date.now(), duplicated: Date.now() },
        }),
      });
    },
    [store, persist],
  );

  const toggleFavourite = useCallback(
    (presetKey: string) => {
      const has = store.favourites.includes(presetKey);
      persist({
        ...store,
        favourites: has ? store.favourites.filter((k) => k !== presetKey) : [...store.favourites, presetKey],
      });
    },
    [store, persist],
  );

  const isFavourite = useCallback((presetKey: string) => store.favourites.includes(presetKey), [store.favourites]);

  /** Most recently applied first. */
  const recent = useMemo(
    () =>
      Object.entries(store.entries)
        .filter(([, e]) => e.last > 0)
        .sort((a, b) => b[1].last - a[1].last)
        .slice(0, RECENT_LIMIT)
        .map(([k]) => k),
    [store.entries],
  );

  /** Most applied first; ties broken by recency so the list is stable but not stale. */
  const frequent = useMemo(
    () =>
      Object.entries(store.entries)
        .filter(([, e]) => e.uses > 1)
        .sort((a, b) => b[1].uses - a[1].uses || b[1].last - a[1].last)
        .slice(0, RECENT_LIMIT)
        .map(([k]) => k),
    [store.entries],
  );

  /** Layouts whose spreads were duplicated recently — the "make another like that" shortcut. */
  const recentlyDuplicated = useMemo(
    () =>
      Object.entries(store.entries)
        .filter(([, e]) => e.duplicated > 0)
        .sort((a, b) => b[1].duplicated - a[1].duplicated)
        .slice(0, RECENT_LIMIT)
        .map(([k]) => k),
    [store.entries],
  );

  const usesOf = useCallback((presetKey: string) => store.entries[presetKey]?.uses ?? 0, [store.entries]);

  return {
    favourites: store.favourites,
    isFavourite,
    toggleFavourite,
    markUsed,
    markDuplicated,
    recent,
    frequent,
    recentlyDuplicated,
    usesOf,
    hasHistory: Object.keys(store.entries).length > 0,
  };
}

export type LayoutMemoryApi = ReturnType<typeof useLayoutMemory>;
