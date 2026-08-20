'use client';

import { useCallback, useState } from 'react';
import { saveLayout, saveCoverDesign } from '@/lib/actions/builder';
import { resolveLayoutForSave, strippedPhotoNote } from '@/lib/builder/persist-layout';
import type { CoverConfig } from '@/lib/builder/cover';
import type { BuilderApi } from './_use-builder';
import type { IdMapApi } from './_use-id-map';

/**
 * THE SAVE CONTROLLER — serialization, persistence and the saved/dirty bookkeeping around it.
 *
 * Extracted from the builder unchanged. It owns the one thing that must never be duplicated or
 * bypassed: the SERIALIZATION BOUNDARY, where optimistic ids are resolved and — if still
 * unresolved — stripped, so a temporary id can never reach the server.
 *
 * Everything here was previously inline in the orchestrator. No call, order or side effect
 * changed; the flush-cover-then-save-layout sequence and the "keep the album dirty when
 * placements were stripped" rule are preserved exactly.
 */

export type SaveControllerOptions = {
  albumId: string;
  api: BuilderApi;
  idMap: IdMapApi;
  /** Flush any debounced cover write before persisting, so the row isn't stale. */
  flushCoverDebounce: () => void;
  getCover: () => { title: string; coverId: string | null; config: CoverConfig };
  onMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void;
};

export function useSaveController({
  albumId,
  api,
  idMap,
  flushCoverDebounce,
  getCover,
  onMessage,
}: SaveControllerOptions) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  /**
   * THE serialization boundary. The rule itself now lives in `resolveLayoutForSave` so the
   * creation wizard's Auto Create — which produces layouts full of optimistic ids for exactly
   * the same reason — strips them identically. Behaviour here is unchanged; only the location of
   * the rule moved, so there is one source of truth for resolution, stripping and the count.
   */
  const serializeForSave = useCallback(
    () => resolveLayoutForSave(api.serialize(), idMap),
    [api, idMap],
  );

  /** Appended to a successful save when placements couldn't be persisted yet. */
  const strippedNote = useCallback((n: number) => strippedPhotoNote(n), []);

  /**
   * The ONE reliable customer save: flush the debounced cover design FIRST (so the latest
   * cover/back-cover/title/text/stickers/QR/background is committed, not a stale row), then
   * persist the layout. Only resolves true when EVERY write succeeded; any failure surfaces the
   * error and leaves `dirty` set so exit is blocked. Used by the Save button, ⌘S, and
   * Save & Leave alike.
   */
  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    onMessage(null);
    flushCoverDebounce();
    const cover = getCover();
    // The cover save is UNCONDITIONAL. It used to be skipped whenever the title was blank, which
    // silently discarded every other cover edit (background, elements, base template) along with
    // it. The title is only one field of the cover: a blank one leaves `albums.title` untouched
    // server-side, it does not cancel the write.
    const cov = await saveCoverDesign({
      albumId,
      title: cover.title,
      coverTemplateId: cover.coverId,
      config: cover.config,
    });
    if (!cov.ok) {
      setSaving(false);
      onMessage({ kind: 'err', text: cov.error });
      return false;
    }
    const { blocks: payload, stripped } = serializeForSave();
    const res = await saveLayout({ albumId, blocks: payload });
    setSaving(false);
    if (res.ok) {
      // Still-uploading placements were held back, so the album is NOT fully persisted —
      // keep it dirty (the exit guard stays armed) and say so plainly.
      api.setDirty(stripped > 0);
      setLastSaved(Date.now());
      onMessage({ kind: 'ok', text: `All changes saved.${strippedNote(stripped)}` });
      return true;
    }
    onMessage({ kind: 'err', text: res.error });
    return false;
  }, [albumId, api, flushCoverDebounce, getCover, onMessage, serializeForSave, strippedNote]);

  return { save, saving, setSaving, lastSaved, setLastSaved, serializeForSave, strippedNote };
}
