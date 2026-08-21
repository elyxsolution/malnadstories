'use client';

import { useCallback, useMemo } from 'react';
import { resolveLayerIndex, type LayerAction } from '@/lib/builder/elements';
import type { Block, EditConfig } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import type { BuilderApi, BaseSlot, Selection } from './_use-builder';
import {
  selectedBlockKeys,
  selectedFrames,
  selectedPhotoIds,
  type SelectionState,
  type SelectionTarget,
} from './_selection-model';
import { LABEL_META, PHOTO_LABELS, type PhotoLabel } from './_photo-labels';

/**
 * THE COMMAND LAYER — every editing action, once.
 *
 * WHY THIS EXISTS. Before Phase 6 an action's logic lived in the handler that happened to invoke
 * it first: "remove this photo from the page" was an arrow function inside a slot's control bar.
 * Adding a keyboard shortcut, a context menu and a drag gesture for the same action would have
 * meant three more copies of that logic, each free to drift. So the logic moves here, and the UI
 * becomes a set of TRIGGERS:
 *
 *     Buttons ─┐
 *   Shortcuts ─┼─► commands.removeFromPage() ─► api.batch(...) ─► history
 * Context menu ─┤
 *  Drag & drop ─┘
 *
 * WHAT A COMMAND IS. A plain object: a stable `id`, a human `label`, whether it is `enabled`
 * right now, and a `run()`. Nothing about presentation — a context menu, a toolbar and a
 * shortcut table can all render the same command differently.
 *
 * UNDO IS A PROPERTY OF THE COMMAND, NOT THE UI. Every command that mutates layout wraps its
 * work in `api.batch()`, so a bulk operation over twelve frames is ONE undo entry. That is why
 * history wraps commands rather than UI handlers — a handler doesn't know whether it is one of
 * twelve.
 *
 * SERVER EFFECTS STAY WHERE THEY WERE. `deletePhotos` calls the SAME `DELETE /api/photos/:id`
 * the tray always called, and cancels optimistic uploads through the upload manager rather than
 * inventing a new path. No command introduces a backend interaction that didn't already exist.
 */

/**
 * PHASE 7 adds label commands to the SAME registry rather than a parallel one. A label is set
 * from the tray's context menu, from the canvas, from a bulk selection and (for the first two)
 * from the keyboard — four triggers, and the whole reason this layer exists is that they must
 * be four triggers for ONE implementation. `label:<key>` ids are generated from the label
 * vocabulary so adding a fifth mark never means editing this union.
 */
export type LabelCommandId = `label:${PhotoLabel}` | 'label:clear';

export type CommandId =
  | 'selectAll'
  | 'clearSelection'
  | 'deletePhotos'
  | 'removeFromPage'
  | 'clearPlacement'
  | 'rotatePhotos'
  | 'replacePhoto'
  | 'movePhotoToFrame'
  | 'duplicatePage'
  | 'deletePage'
  | 'undo'
  | 'redo'
  | 'toggleFavourite'
  | 'deleteSelection'
  | LabelCommandId;

export type Command = {
  id: CommandId;
  /** Menu label, already reflecting the selection count ("Remove 3 photos"). */
  label: string;
  enabled: boolean;
  /** True when the action destroys something — menus render these apart, in red. */
  destructive?: boolean;
  run: () => void | Promise<void>;
};

export type CommandDeps = {
  api: BuilderApi;
  blocks: Block[];
  photos: Photo[];
  selection: SelectionState;
  setSelection: (s: SelectionState) => void;
  /** All selectable targets in visual order — Select All operates on this. */
  allTargets: () => SelectionState['targets'];
  /** Server photo deletion + optimistic-upload cancellation, owned by the host. */
  deletePhotoIds: (ids: string[]) => Promise<void>;
  /**
   * Undo / redo. Optional, and defaults to the layout history on `api`, so a host without a
   * second lane is unchanged. The builder passes the SHARED timeline (`useEditHistory`), which
   * spans the layout and image adjustments — otherwise the command-palette Undo and ⌘Z would
   * disagree about what "last" means.
   */
  history?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  /** Persist one photo's edit config (the existing `savePhotoEdit` path). */
  savePhotoEdit: (photoId: string, edit: EditConfig) => void;
  /** Patch the local photo list so an edit shows immediately. */
  patchPhotoEdit: (photoId: string, edit: EditConfig) => void;
  albumSize: number;
  onMessage?: (m: { kind: 'ok' | 'err'; text: string }) => void;
  /**
   * Client-side photo marks (Phase 7). Supplied by the host's `useLabels` store — the command
   * layer never touches storage itself, exactly as it never touches the network itself.
   */
  labels?: {
    labelOf: (photoId: string) => PhotoLabel | null;
    toggle: (photoIds: readonly string[], label: PhotoLabel) => void;
    clear: (photoIds: readonly string[]) => void;
  };
  /** Star / unstar the selected photos (the existing tray favourites store). */
  favourites?: {
    isFavourite: (photoId: string) => boolean;
    toggle: (photoId: string) => void;
  };
  /** Told which layout a duplicated page was built on, so layout memory can record it. */
  onDuplicatedPreset?: (presetKey: string | undefined) => void;
  /**
   * The FOCUSED spread and the single element selected on it.
   *
   * Two selection stores coexist by design: the multi-select store (`selection`, above) spans
   * pages and holds frames + tray photos, while text / stickers / QR are only ever selected one
   * at a time on the focused spread and live in the builder's `Selection` union. Delete has to
   * consult BOTH to know what the user actually means, so the resolution lives here — in the
   * command layer — rather than in a keyboard handler that would inevitably drift from it.
   */
  focus?: {
    blockKey: string | null;
    element: Selection;
    /** Reset the element selection after deleting it, so the inspector isn't left on a dead id. */
    clearElement: () => void;
  };
};

/** Rotate 90° in either direction, wrapping — the 0/90/180/270 vocabulary `EditConfig` uses. */
function nextRotation(current: EditConfig['rotate'], dir: 1 | -1 = 1): 0 | 90 | 180 | 270 {
  const r = current ?? 0;
  return (((r + dir * 90 + 360) % 360) as 0 | 90 | 180 | 270);
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function useCommands(deps: CommandDeps) {
  const {
    api,
    blocks,
    photos,
    selection,
    setSelection,
    allTargets,
    deletePhotoIds,
    history: historyDep,
    savePhotoEdit,
    patchPhotoEdit,
    albumSize,
    onMessage,
    labels,
    favourites,
    onDuplicatedPreset,
    focus,
  } = deps;

  const history = historyDep ?? api;

  const photoIds = selectedPhotoIds(selection);
  const frames = selectedFrames(selection);
  const blockKeys = selectedBlockKeys(selection);

  /**
   * Photos referenced by the current selection, whether selected in the tray or through the
   * frame that holds them. This is what makes "rotate" work identically from the tray and from
   * the canvas without two implementations.
   */
  const targetPhotoIds = useMemo(() => {
    const ids = new Set(photoIds);
    for (const f of frames) {
      const block = blocks.find((b) => b.key === f.blockKey);
      if (!block) continue;
      if (f.kind === 'base') {
        const idx = f.slot === 'right' ? 1 : 0;
        const id = block.photoIds[idx];
        if (id) ids.add(id);
      } else {
        const ov = block.overlays.find((o) => o.id === f.id);
        if (ov?.photoId) ids.add(ov.photoId);
      }
    }
    return Array.from(ids);
  }, [photoIds, frames, blocks]);

  /** Frames in the selection that currently HOLD a photo — the ones worth clearing. */
  const occupiedFrames = useMemo(
    () =>
      frames.filter((f) => {
        const block = blocks.find((b) => b.key === f.blockKey);
        if (!block) return false;
        if (f.kind === 'base') return !!block.photoIds[f.slot === 'right' ? 1 : 0];
        return !!block.overlays.find((o) => o.id === f.id)?.photoId;
      }),
    [frames, blocks],
  );

  // ── individual commands ─────────────────────────────────────────────────────────

  const doSelectAll = useCallback(() => {
    setSelection({ targets: [...allTargets()], anchor: null });
  }, [allTargets, setSelection]);

  const doClearSelection = useCallback(() => {
    setSelection({ targets: [], anchor: null });
  }, [setSelection]);

  /**
   * Delete photos from the ALBUM. Removes them from every page first (one batch), then performs
   * the server deletion the tray has always used. Optimistic photos are cancelled instead —
   * they have no server row, so a DELETE would be meaningless.
   */
  const doDeletePhotos = useCallback(async () => {
    const ids = targetPhotoIds;
    if (ids.length === 0) return;
    api.batch(() => api.removePhotosEverywhere(ids));
    setSelection({ targets: [], anchor: null });
    await deletePhotoIds(ids);
  }, [targetPhotoIds, api, deletePhotoIds, setSelection]);

  /**
   * Take photos OFF their pages without deleting them — they return to the tray. The single
   * most-used bulk action, and the clearest case for batching: twelve frames, one undo.
   */
  const doRemoveFromPage = useCallback(() => {
    if (occupiedFrames.length === 0) return;
    api.batch(() =>
      api.clearFrames(
        occupiedFrames.map((f) => (f.kind === 'base' ? { blockKey: f.blockKey, slot: f.slot } : { blockKey: f.blockKey, overlayId: f.id })),
      ),
    );
    onMessage?.({
      kind: 'ok',
      text: `${occupiedFrames.length} ${plural(occupiedFrames.length, 'photo')} returned to your tray.`,
    });
  }, [occupiedFrames, api, onMessage]);

  /** Clear every frame on the selected page(s) — "start this spread again". */
  const doClearPlacement = useCallback(() => {
    const keys = blockKeys.length > 0 ? blockKeys : [];
    if (keys.length === 0) return;
    api.batch(() => {
      for (const key of keys) {
        const block = blocks.find((b) => b.key === key);
        if (!block) continue;
        api.clearFrames([
          ...block.photoIds.map((_, i) => ({ blockKey: key, slot: (i === 1 ? 'right' : 'left') as BaseSlot })),
          ...block.overlays.filter((o) => o.photoId).map((o) => ({ blockKey: key, overlayId: o.id as string })),
        ]);
      }
    });
  }, [blockKeys, blocks, api]);

  /**
   * Rotate every selected photo 90°. Rotation lives on `photos.edit_config`, so this is a photo
   * operation rather than a layout one — it does not enter the block history, but it IS applied
   * to all selected photos in one gesture and persisted through the existing action.
   */
  /**
   * THE single write path for a photo edit — patch local state so the canvas updates on the same
   * frame, then persist through the existing `savePhotoEdit`. Every geometry action in the
   * floating toolbar (rotate, flip, zoom, fill) funnels through here, which is why none of them
   * had to reimplement the live-then-persist contract the inspector sliders already had.
   */
  const applyPhotoEdit = useCallback(
    (photoId: string, patch: Partial<EditConfig>) => {
      const photo = photos.find((p) => p.id === photoId);
      // Every edit is authored against the worker's sanitized master — the same gate the
      // editors already enforce, applied once, here.
      if (!photo || photo.status !== 'ready') return;
      const edit: EditConfig = { ...(photo.edit ?? {}), ...patch };
      patchPhotoEdit(photoId, edit);
      savePhotoEdit(photoId, edit);
    },
    [photos, patchPhotoEdit, savePhotoEdit],
  );

  /** Rotate every selected photo. `dir` is +1 clockwise, −1 anticlockwise. */
  const doRotatePhotos = useCallback(
    (dir: 1 | -1 = 1) => {
      for (const id of targetPhotoIds) {
        const photo = photos.find((p) => p.id === id);
        if (!photo || photo.status !== 'ready') continue;
        applyPhotoEdit(id, { rotate: nextRotation(photo.edit?.rotate, dir) });
      }
    },
    [targetPhotoIds, photos, applyPhotoEdit],
  );

  /**
   * Put `photoId` into a specific frame. THE single implementation behind drag-and-drop, the
   * picker, tap-to-place and cross-page moves — `assignBaseSlot`/`replaceOverlay` already strip
   * the photo from wherever it was, so a move is just a placement.
   */
  const doPlacePhoto = useCallback(
    (photoId: string, target: { blockKey: string; slot?: BaseSlot; overlayId?: string }) => {
      api.batch(() => {
        if (target.slot) api.assignBaseSlot(target.blockKey, target.slot, photoId);
        else if (target.overlayId) api.replaceOverlay(target.blockKey, target.overlayId, photoId);
      });
    },
    [api],
  );

  /**
   * BATCH REPLACE — fill the selected frames from a pool of photos, in order, in one gesture.
   *
   * The workflow the brief describes ("select missing frames → choose photos → auto-match") is
   * really an ORDERED ZIP: the Nth selected frame receives the Nth chosen photo. That ordering
   * is what makes it predictable — the user can see, before committing, which photo will land
   * where, because it is simply the order they appear in.
   *
   * It reuses everything: the frames come from the selection store, the photos from the tray
   * (including ones still uploading, since `assignBaseSlot` accepts optimistic ids), and the
   * whole zip runs inside ONE `api.batch()` so a twelve-frame refill is a single undo.
   *
   * Frames beyond the supplied photos are left exactly as they were — a short pool fills what it
   * can rather than clearing the remainder.
   */
  const doBatchReplace = useCallback(
    (photoIdsInOrder: string[]) => {
      // Prefer EMPTY frames — "replace missing photos" means filling holes first — then fall back
      // to occupied ones so an explicit multi-select replace still works.
      const empties = frames.filter((f) => !occupiedFrames.some((o) => JSON.stringify(o) === JSON.stringify(f)));
      const ordered = [...empties, ...occupiedFrames];
      if (ordered.length === 0 || photoIdsInOrder.length === 0) return 0;

      const pairs = ordered.slice(0, photoIdsInOrder.length).map((frame, i) => ({ frame, photoId: photoIdsInOrder[i] }));
      api.batch(() => {
        for (const { frame, photoId } of pairs) {
          if (frame.kind === 'base') api.assignBaseSlot(frame.blockKey, frame.slot, photoId);
          else api.replaceOverlay(frame.blockKey, frame.id, photoId);
        }
      });
      onMessage?.({
        kind: 'ok',
        text: `Filled ${pairs.length} ${plural(pairs.length, 'frame')}.`,
      });
      return pairs.length;
    },
    [frames, occupiedFrames, api, onMessage],
  );

  /**
   * ── LAYER ORDERING, ONE IMPLEMENTATION FOR EVERY MOVABLE OBJECT ───────────────
   *
   * The model keeps each element family in its own array (overlays / texts / stickers / QR),
   * and render order IS array order — later means on top. Every layer operation is therefore
   * "move this element to index j", expressed as |j − i| adjacent swaps through the SAME
   * `reorder*` primitives the old up/down buttons called. The swaps run inside `api.batch()`,
   * so "Bring to front" across a ten-deep stack is ONE undo entry, and the mutation marks the
   * album dirty exactly like any other edit — the save controller needs nothing new.
   *
   * `above`/`below` are the explicit forms: place the element directly on top of (or beneath)
   * a NAMED sibling. They resolve to the same remove-then-insert index arithmetic, so all six
   * menu items share one code path.
   */
  const moveLayer = useCallback(
    (
      target: { kind: 'overlay' | 'text' | 'sticker' | 'qr'; blockKey: string; id: string },
      action: LayerAction,
    ) => {
      const block = blocks.find((b) => b.key === target.blockKey);
      if (!block) return;
      const list: { id?: string }[] =
        target.kind === 'overlay' ? block.overlays : target.kind === 'text' ? block.texts : target.kind === 'sticker' ? block.stickers : block.qrs;
      const i = list.findIndex((el) => el.id === target.id);
      if (i < 0) return;
      // The index arithmetic is shared with the cover canvas (`lib/builder/elements`), which has
      // element arrays but no blocks — one definition of what "forward" means on either surface.
      const j = resolveLayerIndex(list, target.id, action);
      if (j === null) return;

      const dir: -1 | 1 = j > i ? 1 : -1;
      const steps = Math.abs(j - i);
      const step =
        target.kind === 'overlay'
          ? api.reorderOverlay
          : target.kind === 'text'
            ? api.reorderText
            : target.kind === 'sticker'
              ? api.reorderSticker
              : api.reorderQr;
      api.batch(() => {
        for (let n = 0; n < steps; n++) step(target.blockKey, target.id, dir);
      });
    },
    [blocks, api],
  );

  const doDuplicatePage = useCallback(
    (blockKey?: string) => {
      const key = blockKey ?? blockKeys[0];
      if (!key) return;
      // Duplicating is how people repeat a layout they like, so it feeds layout memory the same
      // way applying a preset does — read BEFORE the mutation, while the source still resolves.
      const preset = blocks.find((b) => b.key === key)?.preset;
      api.batch(() => api.duplicateBlock(key, albumSize));
      onDuplicatedPreset?.(preset);
    },
    [blockKeys, blocks, api, albumSize, onDuplicatedPreset],
  );

  const doDeletePage = useCallback(
    (blockKey?: string) => {
      const key = blockKey ?? blockKeys[0];
      if (!key) return;
      api.batch(() => api.removeBlock(key));
      setSelection({ targets: [], anchor: null });
    },
    [blockKeys, api, setSelection],
  );

  /**
   * Mark the selected photos. Works identically whether the selection came from the tray or
   * from the frames holding those photos (`targetPhotoIds` already resolves both), which is what
   * lets someone right-click a photo ON a page and mark it "replace later" without first
   * hunting for it in the tray.
   */
  const doToggleLabel = useCallback(
    (label: PhotoLabel) => {
      const ids = targetPhotoIds;
      if (ids.length === 0 || !labels) return;
      const removing = ids.every((id) => labels.labelOf(id) === label);
      labels.toggle(ids, label);
      onMessage?.({
        kind: 'ok',
        text: removing
          ? `Cleared the mark on ${ids.length} ${plural(ids.length, 'photo')}.`
          : `Marked ${ids.length} ${plural(ids.length, 'photo')} “${LABEL_META[label].label}”.`,
      });
    },
    [targetPhotoIds, labels, onMessage],
  );

  const doClearLabels = useCallback(() => {
    const ids = targetPhotoIds;
    if (ids.length === 0 || !labels) return;
    labels.clear(ids);
  }, [targetPhotoIds, labels]);

  const doToggleFavourite = useCallback(() => {
    const ids = targetPhotoIds;
    if (ids.length === 0 || !favourites) return;
    // A mixed selection STARS rather than unstars — the safer reading of an ambiguous gesture,
    // and it means repeating the command always converges instead of flip-flopping.
    const allStarred = ids.every((id) => favourites.isFavourite(id));
    for (const id of ids) {
      if (favourites.isFavourite(id) === allStarred) favourites.toggle(id);
    }
  }, [targetPhotoIds, favourites]);

  /**
   * ── DELETE, RESOLVED BY PRIORITY ──────────────────────────────────────────────
   *
   * THE BUG THIS FIXES. Delete used to be hard-wired to `removeFromPage`, which is a FRAME
   * operation: it strips the photo out of whatever holds it and leaves the holder behind. On a
   * base slot that is exactly right — the page keeps its slot, the photo goes back to the tray.
   * On an OVERLAY it is wrong twice over: the user asked to delete the overlay they had
   * selected, and what they got was an empty container still sitting on the page. Worse, an
   * overlay with no photo in it made the command `enabled === false`, so Delete silently did
   * nothing at all and the keystroke fell through to the browser.
   *
   * THE LADDER. Delete now resolves against the highest-priority ACTIVE selection:
   *
   *     overlay → text → sticker → QR → base photo → (stop)
   *
   * Each tier is checked in order and the first non-empty one wins; nothing below it runs. The
   * ladder deliberately STOPS before "page" and "album". Removing a spread destroys layout work
   * that a keystroke should never be able to reach by accident — it stays an explicit, labelled
   * action in the Inspector and the page-strip menu, both of which are unchanged. Background is
   * absent for a different reason: it has no selection state to be "active", so there is nothing
   * for the ladder to match on (see the deliverable notes).
   *
   * MULTI-SELECT IS THE SAME PATH. Twelve overlays selected across four spreads delete in ONE
   * `api.batch`, so it is one undo entry — the same guarantee every other bulk command gives.
   */
  const overlayTargets = useMemo(
    () => selection.targets.filter((t): t is Extract<SelectionTarget, { kind: 'overlay' }> => t.kind === 'overlay'),
    [selection.targets],
  );

  /** Which tier Delete would act on right now — drives both the label and `enabled`. */
  const deleteTier = useMemo<'overlay' | 'text' | 'sticker' | 'qr' | 'frame' | null>(() => {
    if (overlayTargets.length > 0) return 'overlay';
    const el = focus?.element;
    if (focus?.blockKey && el) {
      if (el.kind === 'overlay') return 'overlay';
      if (el.kind === 'text') return 'text';
      if (el.kind === 'sticker') return 'sticker';
      if (el.kind === 'qr') return 'qr';
    }
    if (occupiedFrames.length > 0) return 'frame';
    return null;
  }, [overlayTargets.length, focus?.element, focus?.blockKey, occupiedFrames.length]);

  const doDeleteSelection = useCallback(() => {
    // 1 — OVERLAYS. The multi-selection wins; it can span pages, so each target carries its own
    // blockKey. This is the tier the old binding got wrong.
    if (overlayTargets.length > 0) {
      api.batch(() => {
        for (const o of overlayTargets) api.removeOverlay(o.blockKey, o.id);
      });
      setSelection({ targets: [], anchor: null });
      focus?.clearElement();
      onMessage?.({
        kind: 'ok',
        text: `Removed ${overlayTargets.length} ${plural(overlayTargets.length, 'overlay')}.`,
      });
      return;
    }

    // 2–5 — the single-element tiers, all scoped to the focused spread. `key` is null on the
    // cover (which has its own element model), so the ladder simply doesn't apply there.
    const key = focus?.blockKey;
    const el = focus?.element;
    if (focus && key && el) {
      switch (el.kind) {
        case 'overlay':
          api.batch(() => api.removeOverlay(key, el.id));
          focus.clearElement();
          return;
        case 'text':
          api.batch(() => api.removeText(key, el.id));
          focus.clearElement();
          return;
        case 'sticker':
          api.batch(() => api.removeSticker(key, el.id));
          focus.clearElement();
          return;
        case 'qr':
          api.batch(() => api.removeQr(key, el.id));
          focus.clearElement();
          return;
        default:
          break; // 'base' / 'none' fall through to the frame tier below
      }
    }

    // 6 — BASE PHOTOS. The original behaviour, now reached only when nothing above matched:
    // the photo returns to the tray and the page keeps its slot.
    if (occupiedFrames.length > 0) doRemoveFromPage();

    // 7+ — page / album: deliberately unreachable from the keyboard. See the note above.
  }, [overlayTargets, focus, api, occupiedFrames.length, doRemoveFromPage, setSelection, onMessage]);

  // ── the registry ────────────────────────────────────────────────────────────────

  const commands = useMemo<Record<CommandId, Command>>(() => {
    const nPhotos = targetPhotoIds.length;
    const nFrames = occupiedFrames.length;
    const rotatable = targetPhotoIds.filter((id) => photos.find((p) => p.id === id)?.status === 'ready').length;

    /** One command per label, generated from the vocabulary rather than hand-written. */
    const labelCommands = Object.fromEntries(
      PHOTO_LABELS.map((key) => {
        const meta = LABEL_META[key];
        const allHave = nPhotos > 0 && targetPhotoIds.every((id) => labels?.labelOf(id) === key);
        return [
          `label:${key}`,
          {
            id: `label:${key}` as CommandId,
            label: allHave ? `Clear “${meta.label}”` : nPhotos > 1 ? `Mark ${nPhotos} · ${meta.label}` : meta.label,
            enabled: !!labels && nPhotos > 0,
            run: () => doToggleLabel(key),
          } satisfies Command,
        ];
      }),
    ) as Record<LabelCommandId, Command>;

    return {
      ...labelCommands,
      'label:clear': {
        id: 'label:clear',
        label: 'Remove mark',
        // Only offered when there is actually a mark to remove — a no-op menu row is clutter.
        enabled: !!labels && nPhotos > 0 && targetPhotoIds.some((id) => labels?.labelOf(id) !== null),
        run: doClearLabels,
      },
      toggleFavourite: {
        id: 'toggleFavourite',
        label:
          nPhotos > 0 && targetPhotoIds.every((id) => favourites?.isFavourite(id))
            ? nPhotos > 1
              ? `Unstar ${nPhotos} photos`
              : 'Unstar'
            : nPhotos > 1
              ? `Star ${nPhotos} photos`
              : 'Star',
        enabled: !!favourites && nPhotos > 0,
        run: doToggleFavourite,
      },
      selectAll: { id: 'selectAll', label: 'Select all', enabled: true, run: doSelectAll },
      clearSelection: {
        id: 'clearSelection',
        label: 'Deselect',
        enabled: selection.targets.length > 0,
        run: doClearSelection,
      },
      deletePhotos: {
        id: 'deletePhotos',
        label: nPhotos > 1 ? `Delete ${nPhotos} photos` : 'Delete photo',
        enabled: nPhotos > 0,
        destructive: true,
        run: doDeletePhotos,
      },
      removeFromPage: {
        id: 'removeFromPage',
        label: nFrames > 1 ? `Remove ${nFrames} from pages` : 'Remove from page',
        enabled: nFrames > 0,
        run: doRemoveFromPage,
      },
      /**
       * What the Delete key runs. The label names the TIER it would act on, so the shortcuts
       * overlay and any menu rendering it tell the truth about what is about to happen.
       */
      deleteSelection: {
        id: 'deleteSelection',
        label:
          deleteTier === 'overlay'
            ? overlayTargets.length > 1
              ? `Delete ${overlayTargets.length} overlays`
              : 'Delete overlay'
            : deleteTier === 'text'
              ? 'Delete text'
              : deleteTier === 'sticker'
                ? 'Delete sticker'
                : deleteTier === 'qr'
                  ? 'Delete QR code'
                  : nFrames > 1
                    ? `Remove ${nFrames} from pages`
                    : 'Remove from page',
        enabled: deleteTier !== null,
        destructive: deleteTier !== null && deleteTier !== 'frame',
        run: doDeleteSelection,
      },
      clearPlacement: {
        id: 'clearPlacement',
        label: blockKeys.length > 1 ? 'Clear these pages' : 'Clear this page',
        enabled: blockKeys.length > 0,
        destructive: true,
        run: doClearPlacement,
      },
      rotatePhotos: {
        id: 'rotatePhotos',
        label: rotatable > 1 ? `Rotate ${rotatable} photos` : 'Rotate 90°',
        enabled: rotatable > 0,
        run: () => doRotatePhotos(1),
      },
      replacePhoto: {
        id: 'replacePhoto',
        label: 'Replace photo',
        enabled: occupiedFrames.length === 1,
        run: () => {
          /* opened by the host's picker — the placement itself goes through `placePhoto` */
        },
      },
      movePhotoToFrame: {
        id: 'movePhotoToFrame',
        label: 'Move to frame',
        enabled: false, // invoked directly by drag-and-drop with explicit arguments
        run: () => {},
      },
      duplicatePage: {
        id: 'duplicatePage',
        label: 'Duplicate page',
        enabled: blockKeys.length > 0,
        run: () => doDuplicatePage(),
      },
      deletePage: {
        id: 'deletePage',
        label: 'Delete page',
        enabled: blockKeys.length > 0,
        destructive: true,
        run: () => doDeletePage(),
      },
      undo: { id: 'undo', label: 'Undo', enabled: history.canUndo, run: history.undo },
      redo: { id: 'redo', label: 'Redo', enabled: history.canRedo, run: history.redo },
    };
  }, [
    targetPhotoIds,
    occupiedFrames,
    blockKeys,
    photos,
    selection.targets.length,
    history.canUndo,
    history.canRedo,
    history.undo,
    history.redo,
    doSelectAll,
    doClearSelection,
    doDeletePhotos,
    doRemoveFromPage,
    doClearPlacement,
    doRotatePhotos,
    doDuplicatePage,
    doDeletePage,
    labels,
    favourites,
    doToggleLabel,
    doClearLabels,
    doToggleFavourite,
    deleteTier,
    overlayTargets,
    doDeleteSelection,
  ]);

  return {
    commands,
    /** Direct invocations that take arguments rather than reading the selection. */
    placePhoto: doPlacePhoto,
    batchReplace: doBatchReplace,
    duplicatePage: doDuplicatePage,
    deletePage: doDeletePage,
    /** Geometry + tone writes for ONE photo — the floating toolbar's single write path. */
    applyPhotoEdit,
    /** Layer ordering for any movable object — the Layers menu's single write path. */
    moveLayer,
    /** Rotate the current selection in either direction (the toolbar's two rotate buttons). */
    rotateBy: doRotatePhotos,
    /** Derived facts the UI needs for labels and enablement. */
    targetPhotoIds,
    occupiedFrames,
  };
}

export type CommandsApi = ReturnType<typeof useCommands>;
