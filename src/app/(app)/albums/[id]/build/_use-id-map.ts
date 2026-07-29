'use client';

import { useCallback, useRef } from 'react';
import { isTempPhotoId } from '@/lib/uploads';

/**
 * THE TEMP → REAL ID MAPPING LAYER.
 *
 * When an upload confirms, its optimistic photo is remapped in place — the photo list, the
 * current blocks, and the entire undo history all move to the real id at once, so nothing
 * the user can see or reach still refers to the temp id. That is the primary mechanism and
 * it is what makes the swap invisible.
 *
 * This map is the SAFETY NET behind it, for the one place a stale id could still surface:
 * anything captured OUTSIDE React state before the remap ran — an in-flight closure, a
 * serialization that started a tick earlier, a drag payload already on the clipboard. At the
 * serialization boundary every id is passed through `resolve` before it can reach the
 * server, and `isUnresolvedTemp` identifies the ones that must not be sent at all.
 *
 * It is a ref, not state: resolution must be correct the instant a confirm lands, not on the
 * next render. Nothing re-renders on a mapping change — the remap that accompanies it already
 * updates the photo list, the blocks and the history in the same commit.
 */
export function useIdMap() {
  const mapRef = useRef<Map<string, string>>(new Map());

  /** Record a temp → real association. Idempotent. */
  const register = useCallback((tempId: string, realId: string) => {
    if (!tempId || !realId || tempId === realId) return;
    if (mapRef.current.get(tempId) === realId) return;
    mapRef.current.set(tempId, realId);
  }, []);

  /** Forget a temp id that will never resolve (a cancelled upload). */
  const forget = useCallback((tempId: string) => {
    mapRef.current.delete(tempId);
  }, []);

  /** The canonical id for `id`: the real one if known, otherwise `id` unchanged. */
  const resolve = useCallback((id: string): string => mapRef.current.get(id) ?? id, []);

  /**
   * True when `id` is a temp id with no known real id yet — i.e. a photo the server does
   * not have. These must never be sent; the caller strips them.
   */
  const isUnresolvedTemp = useCallback(
    (id: string): boolean => isTempPhotoId(id) && !mapRef.current.has(id),
    [],
  );

  return { register, forget, resolve, isUnresolvedTemp };
}

export type IdMapApi = ReturnType<typeof useIdMap>;
