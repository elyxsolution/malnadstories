'use client';

import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

/**
 * PENDING AUTO CREATE PLACEMENTS — where a photo was *meant* to go, for the window between
 * "Auto Create arranged it" and "the upload confirmed".
 *
 * THE PROBLEM. Auto Create can now place photos that are still uploading, under their optimistic
 * `tmp_<taskId>` id. `saveLayout` cannot store those — a temp id refers to a photo the server has
 * never heard of, and sending one fails the whole save — so the shared boundary strips them. That
 * is correct for the DATABASE, but the wizard then navigates and its in-memory blocks die with the
 * component. The builder loads the persisted (stripped) layout, and when those uploads finally
 * confirm nothing remembers where they were supposed to be. The arrangement the customer was shown
 * silently lost half its photos.
 *
 * THE FIX is not to persist temp ids, and not to re-run Auto Create later (which could produce a
 * different arrangement — ordering, dimensions and the photo set have all moved on). It is simply
 * to remember the INTENT across the one navigation it has to survive, and replay it per photo as
 * each id becomes real.
 *
 * WHAT THIS IS NOT. It holds no blobs, no File handles, no upload state and no layout algorithm —
 * only coordinates. Upload lifecycle stays entirely in `UploadProvider`/`UploadManager`; this
 * cannot interfere with confirmation or preview ownership because it never touches either.
 *
 * LIFETIME. Mounted in `(app)/layout.tsx`, which Phase 0 proved is not remounted by
 * /albums/new → /albums/[id]/build — the exact and only transition this must survive. It is
 * deliberately in-memory: a full document reload drops it, and that is the documented boundary
 * (Phase 3 guarantees SPA navigation, not reload). Nothing is written to localStorage.
 *
 * SCOPED BY ALBUM. Keyed by the album id the Auto Create ran for, so Album A's intent can never be
 * replayed into Album B.
 */

/**
 * One photo's intended home, recorded against the layout AS PERSISTED so the coordinates still
 * mean something after the strip compacts base slots.
 *
 * `blockIndex` is the block's sequence position — the same ordering `album_pages.page_number`
 * stores and the builder loads by, so it survives the round trip. Block keys and overlay ids do
 * NOT survive (both are regenerated on load), which is why this is positional.
 */
export type PendingPlacement = {
  /** The optimistic id this placement is waiting on. */
  tempPhotoId: string;
  /** Index into the album's block array. */
  blockIndex: number;
  /** Preferred slot inside that block. Restoration falls back to any free slot in the block. */
  slot:
    | { kind: 'base'; index: number }
    | { kind: 'overlay'; index: number };
};

type Store = Map<string, PendingPlacement[]>;

type PendingPlacementsValue = {
  /** Replace the album's pending intent wholesale — a new Auto Create supersedes the old one. */
  set: (albumId: string, placements: PendingPlacement[]) => void;
  /** The album's pending intent (empty when there is none). */
  get: (albumId: string) => PendingPlacement[];
  /** Forget one photo's intent — restored, cancelled, or permanently failed. */
  remove: (albumId: string, tempPhotoId: string) => void;
  /** Forget the whole album's intent. */
  clear: (albumId: string) => void;
};

const PendingPlacementsContext = createContext<PendingPlacementsValue | null>(null);

const EMPTY: PendingPlacement[] = [];

export function PendingPlacementsProvider({ children }: { children: ReactNode }) {
  /**
   * A ref, not state: nothing renders from this. The wizard writes it, the builder reads it from
   * inside an upload callback, and a re-render would be pure overhead — the layout change that
   * follows a restoration is what updates the screen.
   */
  const storeRef = useRef<Store | null>(null);
  if (storeRef.current === null) storeRef.current = new Map();
  const store = storeRef.current;

  const value = useMemo<PendingPlacementsValue>(
    () => ({
      set: (albumId, placements) => {
        if (placements.length === 0) store.delete(albumId);
        else store.set(albumId, placements);
      },
      get: (albumId) => store.get(albumId) ?? EMPTY,
      remove: (albumId, tempPhotoId) => {
        const list = store.get(albumId);
        if (!list) return;
        const next = list.filter((p) => p.tempPhotoId !== tempPhotoId);
        if (next.length === 0) store.delete(albumId);
        else store.set(albumId, next);
      },
      clear: (albumId) => {
        store.delete(albumId);
      },
    }),
    [store],
  );

  return <PendingPlacementsContext.Provider value={value}>{children}</PendingPlacementsContext.Provider>;
}

/**
 * Pending Auto Create placements. Returns a no-op store when the provider is absent, so a surface
 * outside the authenticated tree degrades to today's behaviour (the photo simply stays in the
 * tray) rather than throwing — losing a placement is a cosmetic miss, not a reason to break a page.
 */
export function usePendingPlacements(): PendingPlacementsValue {
  return useContext(PendingPlacementsContext) ?? NOOP;
}

const NOOP: PendingPlacementsValue = {
  set: () => {},
  get: () => EMPTY,
  remove: () => {},
  clear: () => {},
};
