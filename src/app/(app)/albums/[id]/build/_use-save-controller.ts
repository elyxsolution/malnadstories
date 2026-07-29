'use client';

import { useCallback, useState } from 'react';
import { saveLayout, saveCoverDesign } from '@/lib/actions/builder';
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
   * THE serialization boundary — the one place blocks become a server payload, and therefore
   * the one place that must guarantee no temporary id ever leaves the browser.
   *
   * Two passes, in order:
   *   1. RESOLVE — every id goes through the mapping layer, so a photo that confirmed after it
   *      was placed is saved under its real id. This is the normal case.
   *   2. STRIP — an id that is still temporary refers to a photo the server does not have.
   *      `saveLayout` validates that every referenced photo belongs to the album, so sending
   *      one would fail the ENTIRE save. It is dropped from the payload instead (the slot saves
   *      empty — a legal state drafts already allow), and the caller tells the user.
   *
   * Nothing is invented: no new endpoint, no placeholder row, no altered server action. The
   * photo stays placed locally, so saving again once it lands persists it.
   */
  const serializeForSave = useCallback(() => {
    let stripped = 0;
    const blocksOut = api.serialize().map((b) => {
      const photoIds: string[] = [];
      for (const id of b.photoIds) {
        const resolved = idMap.resolve(id);
        if (idMap.isUnresolvedTemp(resolved)) stripped += 1;
        else photoIds.push(resolved);
      }
      const overlays = b.overlays.map((o) => {
        if (!o.photoId) return o;
        const resolved = idMap.resolve(o.photoId);
        if (idMap.isUnresolvedTemp(resolved)) {
          stripped += 1;
          // Keep the CONTAINER (its geometry is the user's layout work) — only the photo
          // reference is dropped, exactly like an intentionally empty overlay slot.
          return { ...o, photoId: null };
        }
        return { ...o, photoId: resolved };
      });
      return { ...b, photoIds, overlays };
    });
    return { blocks: blocksOut, stripped };
  }, [api, idMap]);

  /** Appended to a successful save when placements couldn't be persisted yet. */
  const strippedNote = useCallback(
    (n: number) =>
      n === 0
        ? ''
        : ` ${n} photo${n === 1 ? '' : 's'} still uploading — save again once ${n === 1 ? 'it lands' : 'they land'} to keep ${n === 1 ? 'it' : 'them'} on the page.`,
    [],
  );

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
    if (cover.title.trim()) {
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
