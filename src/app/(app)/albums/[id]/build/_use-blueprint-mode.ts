'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveLayout, saveCoverDesign } from '@/lib/actions/builder';
import { updateBlueprintFromAlbum, exitBlueprintDraft } from '@/lib/actions/admin/templates';
import type { CoverConfig } from '@/lib/builder/cover';
import type { BuilderApi } from './_use-builder';

/**
 * BLUEPRINT MODE CONTROLLER — the admin-only branch of the builder, isolated.
 *
 * When an album is a blueprint DRAFT (0046), Save means something different: persist the cover and
 * the pages, then distil BOTH back into the blueprint the draft belongs to. Exit means something
 * different too — return to the admin catalog and clean up the draft. Those two flows were
 * interleaved with the customer save/exit paths in the orchestrator, which made both harder to
 * read than either deserves.
 *
 * PHASE 0 added the cover to that sequence, because the blueprint now owns its front cover and the
 * draft album is where an admin composes it. Nothing else changed: same guards, same messages, and
 * the cover is written with the SAME `saveCoverDesign` action, in the same position, as the
 * customer controller — there is no blueprint-specific cover pipeline.
 */
export function useBlueprintMode({
  albumId,
  api,
  serializeBlocks,
  flushCoverDebounce,
  getCover,
  onMessage,
  onSaved,
}: {
  albumId: string;
  api: BuilderApi;
  /** The shared serialization boundary — blueprint saves go through it too. */
  serializeBlocks: () => { blocks: ReturnType<BuilderApi['serialize']> };
  /** Flush the debounced cover write, exactly as the customer save controller does. */
  flushCoverDebounce: () => void;
  /** The draft's live cover state — the blueprint's cover is authored here (Phase 0). */
  getCover: () => { title: string; coverId: string | null; config: CoverConfig };
  onMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void;
  /** Stamp the shared "last saved" clock so the header reads correctly in either mode. */
  onSaved: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  /**
   * Save Blueprint = persist the current COVER and pages, then distil BOTH into THIS blueprint
   * (updateBlueprintFromAlbum). One click, in-place — the admin keeps editing afterwards.
   *
   * THE COVER WRITE IS THE PHASE 0 ADDITION, and it must come first for the same reason it does in
   * the customer controller: `updateBlueprintFromAlbum` re-reads the draft album's `cover_config`
   * from the database, so a cover living only in client state would be invisible to it and the
   * blueprint would be saved with the cover it was OPENED with. Same action, same order, same
   * unconditional-write rule as the customer path — the draft album is admin-owned, so
   * `saveCoverDesign` resolves through its ordinary owner branch with no special casing.
   */
  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    onMessage(null);
    flushCoverDebounce();
    const cover = getCover();
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
    const layout = await saveLayout({ albumId, blocks: serializeBlocks().blocks });
    if (!layout.ok) {
      setSaving(false);
      onMessage({ kind: 'err', text: layout.error });
      return false;
    }
    const res = await updateBlueprintFromAlbum({ albumId });
    setSaving(false);
    if (!res.ok) {
      onMessage({ kind: 'err', text: res.error });
      return false;
    }
    api.setDirty(false);
    onSaved();
    onMessage({ kind: 'ok', text: 'Blueprint saved.' });
    return true;
  }, [albumId, api, serializeBlocks, flushCoverDebounce, getCover, onMessage, onSaved]);

  /**
   * Leaving Blueprint Mode returns to the admin catalog (which restores search/filters/scroll).
   * The draft album is cleaned up server-side; an abandoned never-saved new blueprint is removed.
   */
  const doExit = useCallback(async () => {
    setExitDialogOpen(false);
    await exitBlueprintDraft({ albumId }); // best-effort cleanup
    router.push('/admin/templates');
  }, [albumId, router]);

  const requestExit = useCallback(() => {
    if (api.dirty) setExitDialogOpen(true);
    else void doExit();
  }, [api.dirty, doExit]);

  return { save, saving, doExit, requestExit, exitDialogOpen, setExitDialogOpen };
}
