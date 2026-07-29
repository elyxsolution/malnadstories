'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * PHOTO LABELS — a photographer's working marks on a shoot, client-side only.
 *
 * WHY LOCAL, DELIBERATELY. A label is a note-to-self during a single editing session: "this one
 * needs a second look", "swap this before I print". It is not album content — it never prints,
 * never reaches the PDF, and no server, admin or order flow has any use for it. Adding a column
 * would mean a migration, an RLS policy and a write path for something that is, in the end,
 * scratch paper. So it lives in `localStorage` beside the favourites store (`_tray-filters`),
 * which made the same call for the same reason.
 *
 * ONE LABEL PER PHOTO, not a set. Labels here are a triage STATE — "where is this photo in my
 * process" — and a photo cannot simultaneously be approved and marked for replacement. A
 * multi-label model would need a resolution rule for the tile's colour anyway, and the extra
 * expressiveness buys nothing a filter can't already do.
 *
 * FAVOURITE stays a separate axis (`useFavourites`) on purpose: "I love this shot" and "this
 * shot still needs work" are independent, and collapsing them would lose one of them.
 *
 * The store is intentionally tiny — a `Record<photoId, label>` — because it must survive being
 * read on every tray render. Reads are O(1) map lookups; writes persist synchronously and are
 * best-effort (a full or blocked storage never breaks editing).
 */

export const PHOTO_LABELS = ['favourite', 'selected', 'review', 'replace'] as const;
export type PhotoLabel = (typeof PHOTO_LABELS)[number];

export type LabelMeta = {
  key: PhotoLabel;
  label: string;
  /** What the mark MEANS — shown in menus so the vocabulary stays shared across a team. */
  hint: string;
  /** Tailwind classes for the dot / chip. Semantic tokens only — never a raw hex. */
  dot: string;
  chip: string;
};

/**
 * The vocabulary. Four marks, because five is where a colour code stops being readable at a
 * glance — which is the only reason to have one.
 */
export const LABEL_META: Record<PhotoLabel, LabelMeta> = {
  favourite: {
    key: 'favourite',
    label: 'Favourite',
    hint: 'A standout frame — the ones you build the story around.',
    dot: 'bg-warning',
    chip: 'bg-warning/15 text-warning ring-warning/25',
  },
  selected: {
    key: 'selected',
    label: 'Selected',
    hint: 'Approved for the album.',
    dot: 'bg-studio',
    chip: 'bg-studio/15 text-studio ring-studio/25',
  },
  review: {
    key: 'review',
    label: 'Needs review',
    hint: 'Unsure — come back to this one.',
    dot: 'bg-info',
    chip: 'bg-info/12 text-info ring-info/25',
  },
  replace: {
    key: 'replace',
    label: 'Replace later',
    hint: 'A placeholder — a better frame is coming.',
    dot: 'bg-destructive',
    chip: 'bg-destructive/12 text-destructive ring-destructive/25',
  },
};

export const LABEL_LIST: LabelMeta[] = PHOTO_LABELS.map((k) => LABEL_META[k]);

type LabelMap = Record<string, PhotoLabel>;

const isLabel = (v: unknown): v is PhotoLabel => PHOTO_LABELS.includes(v as PhotoLabel);

export function useLabels(albumId: string) {
  const key = `ms-builder-labels:${albumId}`;
  const [map, setMap] = useState<LabelMap>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return;
      // Validate on the way in — a stale schema or hand-edited storage must never put an
      // unknown value into the tile's class lookup.
      const clean: LabelMap = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) if (isLabel(v)) clean[id] = v;
      setMap(clean);
    } catch {
      /* corrupt or unavailable storage — start empty */
    }
  }, [key]);

  const persist = useCallback(
    (next: LabelMap) => {
      setMap(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full / private mode — labels are a working aid, never essential */
      }
    },
    [key],
  );

  /** Set (or clear, with `null`) the label on a set of photos — the bulk primitive. */
  const setLabel = useCallback(
    (photoIds: readonly string[], label: PhotoLabel | null) => {
      if (photoIds.length === 0) return;
      const next = { ...map };
      for (const id of photoIds) {
        if (label === null) delete next[id];
        else next[id] = label;
      }
      persist(next);
    },
    [map, persist],
  );

  /** Apply a label, or remove it when every target already carries it (a menu toggle). */
  const toggleLabel = useCallback(
    (photoIds: readonly string[], label: PhotoLabel) => {
      const allHave = photoIds.length > 0 && photoIds.every((id) => map[id] === label);
      setLabel(photoIds, allHave ? null : label);
    },
    [map, setLabel],
  );

  /** An optimistic photo's label must follow it to its real id on confirm (Phase 3 contract). */
  const remapId = useCallback(
    (fromId: string, toId: string) => {
      const v = map[fromId];
      if (!v) return;
      const next = { ...map };
      delete next[fromId];
      next[toId] = v;
      persist(next);
    },
    [map, persist],
  );

  const labelOf = useCallback((photoId: string): PhotoLabel | null => map[photoId] ?? null, [map]);

  /** How many photos carry each label — drives which filter chips are worth showing at all. */
  const counts = useMemo(() => {
    const c: Record<PhotoLabel, number> = { favourite: 0, selected: 0, review: 0, replace: 0 };
    for (const v of Object.values(map)) c[v] += 1;
    return c;
  }, [map]);

  const total = useMemo(() => Object.keys(map).length, [map]);

  return { labelOf, setLabel, toggleLabel, remapId, counts, total };
}

export type LabelsApi = ReturnType<typeof useLabels>;
