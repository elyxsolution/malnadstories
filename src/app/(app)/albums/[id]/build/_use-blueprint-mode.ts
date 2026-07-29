'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveLayout } from '@/lib/actions/builder';
import { updateBlueprintFromAlbum, exitBlueprintDraft } from '@/lib/actions/admin/templates';
import type { BuilderApi } from './_use-builder';

/**
 * BLUEPRINT MODE CONTROLLER — the admin-only branch of the builder, isolated.
 *
 * When an album is a blueprint DRAFT (0046), Save means something different: persist the pages,
 * then distil them back into the blueprint the draft belongs to. Exit means something different
 * too — return to the admin catalog and clean up the draft. Those two flows were interleaved with
 * the customer save/exit paths in the orchestrator, which made both harder to read than either
 * deserves.
 *
 * Behaviour is unchanged. This is the same sequence, same guards, same messages — just no longer
 * sharing a scope with the customer flow it has nothing to do with.
 */
export function useBlueprintMode({
  albumId,
  api,
  serializeBlocks,
  onMessage,
  onSaved,
}: {
  albumId: string;
  api: BuilderApi;
  /** The shared serialization boundary — blueprint saves go through it too. */
  serializeBlocks: () => { blocks: ReturnType<BuilderApi['serialize']> };
  onMessage: (m: { kind: 'ok' | 'err'; text: string } | null) => void;
  /** Stamp the shared "last saved" clock so the header reads correctly in either mode. */
  onSaved: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  /**
   * Save Blueprint = persist the current pages (saveLayout) then distil them into THIS blueprint
   * (updateBlueprintFromAlbum). One click, in-place — the admin keeps editing afterwards.
   */
  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    onMessage(null);
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
  }, [albumId, api, serializeBlocks, onMessage, onSaved]);

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
