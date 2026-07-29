'use client';

import { useCallback } from 'react';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { Photo } from '@/lib/builder/photo';
import type { PairPhoto } from './_pair-frame';
import type { PhotoUiState } from './_photo-state';

/**
 * THE `photoFor` resolver — one implementation of "given a photo id, what does a frame need
 * to draw it?".
 *
 * This existed four times before consolidation: `_preview`, `_flipbook` and `_navigator` had
 * become byte-identical copies, and `_builder` carried a fourth near-identical variant. Each
 * copy had to be edited in lockstep every time `PairPhoto` gained a field — which is exactly
 * how the builder's copy fell behind and stopped passing `state`/`since`.
 *
 * The signature is deliberately the same as the inline versions it replaces, so call sites
 * substitute one-for-one and behaviour is identical: same `'full'` variant, same `?? ''`
 * fallback, same `undefined` for an unknown id.
 */
export type PhotoForFn = (id: string | null | undefined) => PairPhoto | undefined;

export function usePhotoFor(
  photoMap: Map<string, Photo>,
  photoStateFor?: (photoId: string) => PhotoUiState | undefined,
): PhotoForFn {
  return useCallback(
    (id) => {
      const p = id ? photoMap.get(id) : undefined;
      if (!p) return undefined;
      return {
        url: resolvePhotoUrl(p, 'full') ?? '',
        edit: p.edit,
        state: photoStateFor?.(p.id),
        since: p.processingSince ?? null,
      };
    },
    [photoMap, photoStateFor],
  );
}
