'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Photo } from '@/lib/builder/photo';
import { orientedAspect, type PhotoUiState } from './_photo-state';
import { PHOTO_LABELS, type PhotoLabel } from './_photo-labels';

/**
 * TRAY FILTERING — composable predicates over the photo list.
 *
 * The Phase 5 tray had a single-choice chip row: pick "Unplaced" and you lost the ability to also
 * say "portrait". Phase 6 makes the axes INDEPENDENT and combines them with AND, which is what
 * people expect from a filter bar and what "filters must compose" means in practice:
 *
 *     search  AND  usage  AND  orientation  AND  state  AND  labels  AND  favourites
 *
 * Each axis is a set, so an empty set means "don't constrain this axis" rather than "match
 * nothing" — selecting no orientation shows every orientation.
 *
 * SEARCH IS ITSELF COMPOSABLE (Phase 7). The box no longer means "filename contains"; it parses
 * `key:value` terms and ANDs them with everything else, so a photographer can type what they
 * mean instead of hunting for a chip:
 *
 *     sunset is:unused is:landscape          → unplaced landscape frames matching "sunset"
 *     label:replace                          → everything marked for replacement
 *     is:fav is:used                         → the favourites that made it into the book
 *
 * The terms are the SAME vocabulary the chips toggle — a token and a chip are two ways to write
 * one predicate, never two implementations. Free text that isn't a term stays a filename match,
 * so the old behaviour is a strict subset of the new one.
 *
 * VIRTUALIZATION IS UNAFFECTED. Filtering happens before the list reaches the tray, so the
 * virtual grid still receives a plain array and windows it exactly as before. The result is
 * memoized on its inputs, so scrolling never re-filters.
 *
 * ORIENTATION uses `orientedAspect`, which reads the worker's dimensions when present and the
 * browser-measured ones otherwise — so a photo can be filtered by shape while it is still
 * uploading, using the Phase 4 client metadata.
 */

export type UsageFilter = 'placed' | 'unplaced';
export type OrientationFilter = 'portrait' | 'landscape' | 'square';
export type StateFilter = 'processing' | 'failed' | 'ready';

export type TrayFilters = {
  search: string;
  usage: Set<UsageFilter>;
  orientation: Set<OrientationFilter>;
  state: Set<StateFilter>;
  labels: Set<PhotoLabel>;
  favouritesOnly: boolean;
};

export const EMPTY_FILTERS: TrayFilters = {
  search: '',
  usage: new Set(),
  orientation: new Set(),
  state: new Set(),
  labels: new Set(),
  favouritesOnly: false,
};

// ── search terms ──────────────────────────────────────────────────────────────────

/**
 * The parsed form of the search box: the free text, plus whatever constraints the `key:value`
 * terms added. Those constraints are UNIONED with the chip axes below, which is what makes
 * typing `is:portrait` and clicking the Portrait chip mean exactly the same thing.
 */
export type ParsedSearch = {
  text: string;
  usage: Set<UsageFilter>;
  orientation: Set<OrientationFilter>;
  state: Set<StateFilter>;
  labels: Set<PhotoLabel>;
  favouritesOnly: boolean;
  /** True when at least one term was recognised — drives the "searching by…" hint. */
  hasTerms: boolean;
};

/** Every accepted term, with its synonyms. Also the source of the in-app help list. */
const USAGE_TERMS: Record<string, UsageFilter> = {
  used: 'placed',
  placed: 'placed',
  unused: 'unplaced',
  unplaced: 'unplaced',
};
const ORIENTATION_TERMS: Record<string, OrientationFilter> = {
  portrait: 'portrait',
  tall: 'portrait',
  landscape: 'landscape',
  wide: 'landscape',
  square: 'square',
};
const STATE_TERMS: Record<string, StateFilter> = {
  processing: 'processing',
  uploading: 'processing',
  pending: 'processing',
  failed: 'failed',
  ready: 'ready',
};
const LABEL_TERMS: Record<string, PhotoLabel> = {
  favourite: 'favourite',
  favorite: 'favourite',
  selected: 'selected',
  review: 'review',
  'needs-review': 'review',
  replace: 'replace',
};

/** What the search box can do, for the hint row. One list, shown and parsed from the same data. */
export const SEARCH_HINTS: { term: string; means: string }[] = [
  { term: 'is:unused', means: 'not on a page yet' },
  { term: 'is:portrait', means: 'tall photos' },
  { term: 'is:fav', means: 'starred' },
  { term: 'is:processing', means: 'still preparing' },
  { term: 'label:replace', means: 'marked to replace' },
];

/**
 * Parse the box. Unknown terms fall through to the free text rather than being dropped, so a
 * typo behaves like a filename search (and finds nothing loudly) instead of silently widening
 * the result to everything.
 */
export function parseSearch(raw: string): ParsedSearch {
  const parsed: ParsedSearch = {
    text: '',
    usage: new Set(),
    orientation: new Set(),
    state: new Set(),
    labels: new Set(),
    favouritesOnly: false,
    hasTerms: false,
  };
  const free: string[] = [];

  for (const word of raw.trim().split(/\s+/)) {
    if (!word) continue;
    const colon = word.indexOf(':');
    if (colon <= 0) {
      free.push(word);
      continue;
    }
    const key = word.slice(0, colon).toLowerCase();
    const value = word.slice(colon + 1).toLowerCase();

    if (key === 'label') {
      const label = LABEL_TERMS[value];
      if (label) {
        parsed.labels.add(label);
        parsed.hasTerms = true;
        continue;
      }
    } else if (key === 'is') {
      if (value === 'fav' || value === 'favourites' || value === 'favorites' || value === 'starred') {
        parsed.favouritesOnly = true;
        parsed.hasTerms = true;
        continue;
      }
      const usage = USAGE_TERMS[value];
      if (usage) {
        parsed.usage.add(usage);
        parsed.hasTerms = true;
        continue;
      }
      const orientation = ORIENTATION_TERMS[value];
      if (orientation) {
        parsed.orientation.add(orientation);
        parsed.hasTerms = true;
        continue;
      }
      const state = STATE_TERMS[value];
      if (state) {
        parsed.state.add(state);
        parsed.hasTerms = true;
        continue;
      }
    }
    free.push(word);
  }

  parsed.text = free.join(' ').toLowerCase();
  return parsed;
}

/** Union of a chip axis and the matching search terms — the one place the two meet. */
function union<T>(chips: Set<T>, terms: Set<T>): Set<T> {
  if (terms.size === 0) return chips;
  if (chips.size === 0) return terms;
  const out = new Set<T>(chips);
  terms.forEach((v) => out.add(v));
  return out;
}

/** Classify a photo's shape. Null (unknown dimensions) matches no orientation filter. */
export function orientationOf(photo: Photo): OrientationFilter | null {
  const a = orientedAspect(photo);
  if (a === null) return null;
  if (a >= 1.15) return 'landscape';
  if (a <= 0.87) return 'portrait';
  return 'square';
}

export function isFiltering(f: TrayFilters): boolean {
  return (
    f.search.trim() !== '' ||
    f.usage.size > 0 ||
    f.orientation.size > 0 ||
    f.state.size > 0 ||
    f.labels.size > 0 ||
    f.favouritesOnly
  );
}

export type FilterContext = {
  isPlaced: (photoId: string) => boolean;
  stateOf: (photo: Photo) => PhotoUiState;
  isFavourite: (photoId: string) => boolean;
  labelOf: (photoId: string) => PhotoLabel | null;
};

/**
 * Apply every axis. Pure — the hook below just supplies the inputs.
 *
 * Chips and search terms are merged per axis BEFORE filtering, so `is:portrait` typed in the box
 * and the Portrait chip are the same constraint arriving by two routes, and turning both on is
 * idempotent rather than contradictory.
 */
export function applyFilters(photos: Photo[], f: TrayFilters, ctx: FilterContext): Photo[] {
  const parsed = parseSearch(f.search);
  const usage = union(f.usage, parsed.usage);
  const orientation = union(f.orientation, parsed.orientation);
  const state = union(f.state, parsed.state);
  const labels = union(f.labels, parsed.labels);
  const favouritesOnly = f.favouritesOnly || parsed.favouritesOnly;
  const q = parsed.text;

  return photos.filter((p) => {
    if (q && !p.filename.toLowerCase().includes(q)) return false;

    if (usage.size > 0) {
      const placed = ctx.isPlaced(p.id);
      if (!(placed ? usage.has('placed') : usage.has('unplaced'))) return false;
    }

    if (orientation.size > 0) {
      const o = orientationOf(p);
      if (!o || !orientation.has(o)) return false;
    }

    if (state.size > 0) {
      const s = ctx.stateOf(p);
      // 'processing' deliberately covers queued/uploading too — from the user's point of view
      // those are all "not ready yet", and splitting them here would be pedantry.
      const bucket: StateFilter | null =
        s === 'failed' ? 'failed' : s === 'ready' ? 'ready' : 'processing';
      if (!bucket || !state.has(bucket)) return false;
    }

    if (labels.size > 0) {
      const l = ctx.labelOf(p.id);
      if (!l || !labels.has(l)) return false;
    }

    if (favouritesOnly && !ctx.isFavourite(p.id)) return false;

    return true;
  });
}

/**
 * FAVOURITES — client-only, per album, persisted in localStorage.
 *
 * Deliberately not a server concept: there is no favourites column and adding one would be a
 * backend change. It is a working aid for sorting through a large import, so surviving a reload
 * on the same device is exactly the right amount of persistence.
 */
export function useFavourites(albumId: string) {
  const key = `ms-builder-favs:${albumId}`;
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* corrupt or unavailable storage — start empty */
    }
  }, [key]);

  const persist = useCallback(
    (next: Set<string>) => {
      setIds(next);
      try {
        localStorage.setItem(key, JSON.stringify(Array.from(next)));
      } catch {
        /* storage full / private mode — favourites are non-essential */
      }
    },
    [key],
  );

  const toggle = useCallback(
    (photoId: string) => {
      const next = new Set(ids);
      if (!next.delete(photoId)) next.add(photoId);
      persist(next);
    },
    [ids, persist],
  );

  /** An optimistic photo's favourite must follow it to its real id on confirm. */
  const remapId = useCallback(
    (fromId: string, toId: string) => {
      if (!ids.has(fromId)) return;
      const next = new Set(ids);
      next.delete(fromId);
      next.add(toId);
      persist(next);
    },
    [ids, persist],
  );

  const isFavourite = useCallback((photoId: string) => ids.has(photoId), [ids]);

  return { favouriteIds: ids, isFavourite, toggle, remapId, count: ids.size };
}

/** The filter state + the filtered result, memoized. */
export function useTrayFilters(photos: Photo[], ctx: FilterContext) {
  const [filters, setFilters] = useState<TrayFilters>(EMPTY_FILTERS);

  const setSearch = useCallback((search: string) => setFilters((f) => ({ ...f, search })), []);

  /** Toggle one value on an axis — the chips' only interaction. */
  const toggleAxis = useCallback(
    <K extends 'usage' | 'orientation' | 'state' | 'labels'>(
      axis: K,
      value: TrayFilters[K] extends Set<infer V> ? V : never,
    ) => {
      setFilters((f) => {
        const next = new Set(f[axis] as Set<unknown>);
        if (!next.delete(value)) next.add(value);
        return { ...f, [axis]: next } as TrayFilters;
      });
    },
    [],
  );

  const toggleFavouritesOnly = useCallback(
    () => setFilters((f) => ({ ...f, favouritesOnly: !f.favouritesOnly })),
    [],
  );

  const reset = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const visible = useMemo(() => applyFilters(photos, filters, ctx), [photos, filters, ctx]);
  /** Parsed once per keystroke, shared with the toolbar's "reading your search as…" hint. */
  const parsedSearch = useMemo(() => parseSearch(filters.search), [filters.search]);

  return {
    filters,
    visible,
    parsedSearch,
    setSearch,
    toggleAxis,
    toggleFavouritesOnly,
    reset,
    active: isFiltering(filters),
  };
}

/** Every label key, re-exported so the toolbar can render chips without a second import. */
export { PHOTO_LABELS };
export type { PhotoLabel };
