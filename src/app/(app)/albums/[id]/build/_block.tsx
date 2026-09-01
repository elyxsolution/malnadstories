'use client';

import { useCallback, useRef, useState } from 'react';
import { X, Crop, SlidersHorizontal, ImagePlus } from 'lucide-react';
import PhotoFrame from './_photo-frame';
import Movable, { SnapGuides, type SnapLine, type SelectMods } from './_movable';
import { useTextResize } from './_use-text-resize';
import TextAutoFit from './_text-autofit';
import { MIN_TEXT_BOX } from '@/lib/builder/text-fit';
import { PrintGutter } from './_pair-frame';
import { TextContent, QrContent, StickerContent } from './_elements-render';
import { InlineTextEditor } from './_element-bits';
import type { CropTarget } from './_use-canvas-crop';
import type { Photo } from '@/lib/builder/photo';
import type { UploadTask } from '@/lib/uploads';
import { photoUiState } from './_photo-state';
import UploadBadge, { stateOpacityClass } from './_upload-badge';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import { backgroundStyle, squareQrHeight } from '@/lib/builder/elements';
import { PAGE_COST, physicalStart, resolveFrameEdit, type Block, type EditConfig, type TextElement } from '@/lib/builder/model';
import { LAYER_CHROME_Z, layerZIndexes } from '@/lib/builder/layers';
import { useStickerBoxFit } from './_sticker-autofit';
import { stickerAspectRatio } from '@/lib/builder/sticker-fit';
import { PASTEBOARD_PCT, PASTEBOARD_ESCAPE } from '@/lib/builder/edit-bounds';
import { TrimGuides, SafeAreaGuides, TRIM_GUIDE_CAPTION } from './_print-guides';
import { hitStack, isSamePoint, resolveHit, type HitPoint, type HitTarget } from '@/lib/builder/hit-test';
import { acceptPhotoDrag, leftDropTarget, readPhotoDrag, startPhotoDrag } from '@/lib/builder/photo-dnd';
import { useBuilderDimensions } from './_dimensions';
import { useLongPress } from './_use-long-press';
/**
 * The adjustment chrome now lives in its own module so the COVER canvas can use the identical
 * implementation (see `_crop-chrome`). Nothing about it changed in the move; `CropHandlers` is
 * re-exported below because several files already import it from here.
 */
import { AdjustHandle, CropBleed, CropLayer, useCropWheel, type CropHandlers } from './_crop-chrome';

export type { CropHandlers };
import type { BuilderApi, BaseSlot, Selection } from './_use-builder';
import type { DragApi } from './_use-drag';
import { selectionFromTarget, type SelectionTarget } from './_selection-model';
import ReadinessBadge from './_readiness-badge';
import { frameKey, type Readiness } from './_quality-model';

/** A gesture that carried no modifier keys. */
const NO_MODS: SelectMods = { meta: false, shift: false, alt: false };

/**
 * The premium open-book editing canvas for ONE spread (open pair). Renders the page with a
 * centre fold, soft paper shadow, page numbers, optional guides, and every editable element —
 * base photos, floating photo overlays, text, and QR — each selectable, draggable, resizable
 * (and text rotatable) through the shared `Movable` engine. All mutations flow through the
 * builder hook (`api`), so persistence is unchanged.
 *
 * TWO LAYERS, ONE PAGE BOX:
 *
 *   RENDER LAYER  — everything that draws: the page's own content (background + base photo
 *                   slots) AND the free elements (photo overlays, text, QR, stickers). It is
 *                   clipped to the trim box, exactly as the preview, flipbook, review mode and
 *                   the PDF clip it. An element pushed past the edge is CUT at the paper's edge
 *                   while you drag it, so the canvas answers "what will print" continuously,
 *                   with no second surface to reconcile it against.
 *   EDITING LAYER — the selection chrome: outlines, the eight handles, the rotate handle, and
 *                   the ghost that stands in for an element pushed entirely off the page. It is
 *                   NOT clipped, so it stays visible and grabbable out on the pasteboard.
 *
 * That split is the whole idea: MOVEMENT is unrestricted (an element may live off the page),
 * RENDERING is clipped (only the part over the paper draws). `Movable` portals its chrome into
 * the second layer — see its `chromeContainer` prop — so there is still exactly one movement
 * implementation and one set of geometry maths.
 *
 * The page geometry itself is a true rectangle — real printed albums have sharp 90° corners, so
 * the canvas does too. Depth comes from the layered paper shadow (`.album-page`), not a radius.
 */
export default function BlockCard({
  api,
  block,
  index,
  blocks,
  photoMap,
  taskFor,
  availablePhotos,
  selection,
  onSelect,
  isTargetSelected,
  onSelectTarget,
  onFrameContextMenu,
  drag,
  onEditPhoto,
  onQuickCrop,
  onBeginCrop,
  onPlacePhoto,
  stickerUrlFor,
  pickActive = false,
  onTapPlaceBase,
  showGuides = false,
  showGutter = true,
  readinessOf,
  onPageEl,
  cropTarget = null,
  cropHandlers,
}: {
  /**
   * MULTI-SELECTION (Phase 6). Optional so this component keeps working unchanged for any host
   * that doesn't supply a selection store (the admin cover designer). `selection`/`onSelect`
   * remain for the single-target inspector; these add the set semantics on top.
   */
  isTargetSelected?: (t: SelectionTarget) => boolean;
  onSelectTarget?: (t: SelectionTarget, mods: { meta: boolean; shift: boolean }) => void;
  onFrameContextMenu?: (e: React.MouseEvent, t: SelectionTarget) => void;
  /** Shared drag store — drives Smart Replace previews and cross-page move feedback. */
  drag?: DragApi;
  api: BuilderApi;
  block: Block;
  index: number;
  blocks: Block[];
  photoMap: Map<string, Photo>;
  /** Upload task backing an optimistic photo, when it still has one (Phase 3). */
  taskFor?: (photoId: string) => UploadTask | undefined;
  availablePhotos: Photo[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /**
   * Open the full editor / Quick Crop ON A NAMED FRAME.
   *
   * `frame` is what makes the modal edit THIS placement rather than the uploaded photo: the same
   * image can be in several frames, so "which crop am I changing?" has no answer derivable from
   * the photo id alone. The base slots below name their own slot; the host turns that into a
   * `FrameRef`, so this component keeps knowing nothing about how an edit is stored.
   */
  onEditPhoto: (photoId: string, frame?: { slot?: BaseSlot; overlayId?: string }) => void;
  onQuickCrop: (
    photoId: string,
    frameAspect: number,
    showGutter: boolean,
    frame?: { slot?: BaseSlot; overlayId?: string },
  ) => void;
  /**
   * PRESS AND HOLD A PHOTO → image-adjustment mode, on the frame that was held.
   *
   * The host owns this so there is exactly one crop-entry action: the same function the floating
   * toolbar's Crop button calls. This component only reports WHICH frame the gesture landed on;
   * it decides nothing about adjustment, and there is no second crop state anywhere.
   * Absent → holding a photo does nothing, which is how any host without a crop layer behaves.
   */
  onBeginCrop?: (target: { slot?: BaseSlot; overlayId?: string; photoId: string }) => void;
  /**
   * Put a photo into one of this spread's frames, through the host's command layer. Optional:
   * a host without one (the admin cover designer) falls back to the local `api` calls, which
   * behave identically minus the batching and the swap notice.
   */
  onPlacePhoto?: (photoId: string, target: { blockKey: string; slot?: BaseSlot; overlayId?: string }) => void;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  pickActive?: boolean;
  onTapPlaceBase?: (slot: BaseSlot) => void;
  showGuides?: boolean;
  /** Draw the printed fold across the spread (Album Settings → Show print gutter). */
  showGutter?: boolean;
  /**
   * Print-readiness for one frame, keyed by `frameKey` (Phase 7). Computed ONCE per edit by the
   * quality engine and looked up here — never recalculated per frame, which is what keeps the
   * badges free during a drag. Absent ⇒ this canvas draws no readiness badges at all, so hosts
   * without a quality report (the admin cover designer) are unaffected.
   */
  readinessOf?: (key: string) => Readiness | undefined;
  /**
   * Publishes the page element upward (Pass 2). The floating context bar anchors itself by
   * measuring THIS box and doing arithmetic against an element's normalized rect — see
   * `useAnchorRect`. Reporting the node is far cheaper than every element reporting its own.
   */
  onPageEl?: (el: HTMLDivElement | null) => void;
  /** The frame currently in in-canvas crop mode, if any (`useCanvasCrop`). */
  cropTarget?: CropTarget | null;
  cropHandlers?: CropHandlers;
}) {
  const { page, pair } = useBuilderDimensions();
  const baseReadiness = (slot: BaseSlot) => readinessOf?.(frameKey({ kind: 'base', blockKey: block.key, blockIndex: index, slot }));
  const overlayReadiness = (id: string) => readinessOf?.(frameKey({ kind: 'overlay', blockKey: block.key, blockIndex: index, id }));
  const pageRef = useRef<HTMLDivElement>(null);
  /**
   * The unclipped chrome layer, as STATE rather than a ref: `Movable` portals into this node, and
   * a portal target must exist at render time. A ref would still be null on the first pass, so
   * the chrome would silently not mount until something else caused a re-render.
   */
  const [chromeEl, setChromeEl] = useState<HTMLDivElement | null>(null);

  /**
   * Text drag-resize → font size. Bound to this block's `patchText` so the gesture produces an
   * ordinary text patch and nothing about persistence, history or rendering learns a new path.
   */
  const textResize = useTextResize(
    useCallback((id: string, patch: Partial<TextElement>) => api.patchText(block.key, id, patch), [api, block.key]),
  );

  // Which frame on THIS spread is being cropped — resolved once rather than per frame.
  const cropOnThisBlock = cropTarget && cropTarget.blockKey === block.key ? cropTarget : null;
  const croppingSlot = cropOnThisBlock?.slot ?? null;
  const croppingOverlay = cropOnThisBlock?.overlayId ?? null;

  /**
   * THE FRAME BEING ADJUSTED, as a normalized rect on the open pair.
   *
   * Every photo container on a spread reduces to a rect here — the two page halves, the
   * full-spread image, and any overlay whatever its shape — which is exactly what makes the
   * adjustment experience identical for all of them rather than special-cased for one. An
   * overlay's rect is its own geometry, so a square, a tall portrait or a rounded inset each get
   * their own correctly-shaped preview with no extra cases.
   */
  const cropFrame = (() => {
    if (!cropOnThisBlock) return null;
    if (cropOnThisBlock.overlayId) {
      const o = block.overlays.find((ov) => ov.id === cropOnThisBlock.overlayId);
      return o ? { rect: { x: o.x, y: o.y, w: o.w, h: o.h }, rounded: true } : null;
    }
    if (cropOnThisBlock.slot === 'image') return { rect: { x: 0, y: 0, w: 1, h: 1 }, rounded: false };
    if (cropOnThisBlock.slot === 'left') return { rect: { x: 0, y: 0, w: 0.5, h: 1 }, rounded: false };
    if (cropOnThisBlock.slot === 'right') return { rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, rounded: false };
    return null;
  })();
  const cropPhoto = cropOnThisBlock ? photoMap.get(cropOnThisBlock.photoId) : undefined;
  const cropUrl = cropPhoto ? resolvePhotoUrl(cropPhoto, 'full') : undefined;
  /**
   * THE GHOST RENDERS THE FRAME'S EDIT TOO.
   *
   * It is the half of adjustment mode that shows what you are choosing FROM, so it has to move
   * with the gesture. Reading `cropPhoto.edit` made it as stale as the frame itself — the whole
   * adjustment surface sat still while the committed value changed underneath it.
   */
  const cropEdit = cropOnThisBlock
    ? resolveFrameEdit(
        cropOnThisBlock.overlayId
          ? block.overlays.find((o) => o.id === cropOnThisBlock.overlayId)?.edit
          : (block.baseEdits ?? [])[cropOnThisBlock.slot === 'right' ? 1 : 0],
        cropPhoto?.edit,
      )
    : null;

  /**
   * WHILE ADJUSTING, THE WHEEL BELONGS TO THE IMAGE.
   *
   * Scrolling over the page during adjustment used to do two things at once: zoom the photo AND
   * scroll the canvas out from under it, so the frame you were aiming at slid away as you zoomed.
   * The fix cannot live in a React `onWheel` — React registers `wheel` passively at its root, so
   * `preventDefault()` there is ignored — so this is a native `{ passive: false }` listener.
   *
   * It is SCOPED, deliberately: attached to this page element only, and only while one of its own
   * frames is in adjustment mode. Nothing else in the editor loses its scrolling, and the moment
   * adjustment ends the listener is gone.
   */
  useCropWheel(pageRef, !!cropOnThisBlock, cropHandlers);
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ kind: 'base'; slot: BaseSlot } | { kind: 'replace'; overlayId: string } | null>(
    null,
  );

  const isDouble = block.template === 'double-spread';
  const start = physicalStart(blocks, index);
  const cost = PAGE_COST[block.template];

  /**
   * REPLACE ON DROP — the ONE placement path on this spread.
   *
   * Every way a photo can land in a frame (dropping on a base slot, dropping on an overlay,
   * picking from the modal) resolves here, so "what happens when the frame is already occupied"
   * is answered once. The answer is: it is replaced, immediately, with no confirmation — the
   * displaced photo is simply no longer referenced by any frame, and the tray is derived from
   * exactly that, so it reappears there on the same render. There is no delete, no second store
   * to keep in step, and undo restores both halves because it is one mutation.
   *
   * `onPlacePhoto` routes through the host's command layer (`commands.placePhoto` → `api.batch`),
   * which is what keeps a replacement a single history entry and lets the host report the swap.
   * Without it the local `api` calls are used, so any host without a command layer still works.
   *
   * Ending the drag here rather than in each handler is the fix for a real leak: the overlay drop
   * never called `drag.end()`, so after dropping onto an overlay the store kept believing a drag
   * was in flight and other frames went on showing replace previews.
   */
  const place = (photoId: string, target: { slot?: BaseSlot; overlayId?: string }) => {
    if (onPlacePhoto) onPlacePhoto(photoId, { blockKey: block.key, ...target });
    else if (target.slot) api.assignBaseSlot(block.key, target.slot, photoId);
    else if (target.overlayId) api.replaceOverlay(block.key, target.overlayId, photoId);
    drag?.end();
  };

  /**
   * REACHING WHAT IS UNDERNEATH.
   *
   * A pointer-down only ever lands on the topmost element, so the last click's position is
   * recorded in the capture phase — before any element's own handler runs — and `resolveHit` uses
   * it to decide whether this click means "select the thing I hit" or "step one level down". Two
   * refs, no state: nothing here should cause a render, and the value is only ever read inside the
   * gesture that immediately follows.
   */
  const lastPoint = useRef<HitPoint | null>(null);
  const pendingPoint = useRef<HitPoint | null>(null);

  const recordPoint = (e: React.PointerEvent) => {
    const box = pageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    pendingPoint.current = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  /**
   * Translate a click on `fallback` into the element the user actually meant.
   *
   * Plain clicks resolve to exactly what was hit, so ordinary editing is untouched. Alt-click and
   * a repeated click at the same spot walk DOWN the stack instead — and either way the element
   * stays exactly where it is in the layer order. Selecting has no side effect on stacking.
   */
  const resolveTarget = (fallback: SelectionTarget, mods: SelectMods): SelectionTarget => {
    const point = pendingPoint.current;
    // Modifier-free clicks, multi-select and range-extension all mean the literal thing hit.
    if (!point || mods.meta || mods.shift) {
      lastPoint.current = point;
      return fallback;
    }
    const repeat = isSamePoint(lastPoint.current, point);
    lastPoint.current = point;
    const stack = hitStack(block, point);
    /**
     * The step is measured from WHAT IS SELECTED, not from what the pointer hit. Those are the
     * same thing on the first click and different on every one after it — the pointer keeps
     * landing on the topmost element no matter how deep the selection has walked, so taking the
     * hit as the origin would bounce between the top two forever instead of descending.
     */
    const current: HitTarget | null =
      selection.kind === 'overlay' || selection.kind === 'text' || selection.kind === 'qr' || selection.kind === 'sticker'
        ? { kind: selection.kind, id: selection.id }
        : null;
    const hit = resolveHit(stack, current, { alt: mods.alt, repeat });
    return hit ? { ...hit, blockKey: block.key } : fallback;
  };

  /** Fire both selection stores for a resolved target — the single place the two are kept in step. */
  const selectResolved = (fallback: SelectionTarget, mods: SelectMods) => {
    const t = resolveTarget(fallback, mods);
    onSelect(selectionFromTarget(t));
    onSelectTarget?.(t, { meta: mods.meta, shift: mods.shift });
  };

  /**
   * ALIGNMENT PEERS — every movable box on this spread, regardless of family.
   *
   * Peer guides used to be wired for overlays only, and only against other OVERLAYS: a sticker
   * could not be lined up with a photo, and text could not be lined up with anything at all. That
   * is not a rule anyone would choose, it is just where the feature stopped. An element is an
   * element — a caption should snap to the overlay above it exactly as one overlay snaps to
   * another — so all four families feed one list and each element aligns to every other.
   */
  const peerBoxes = [
    ...block.overlays.map((o) => ({ id: o.id as string, x: o.x, y: o.y, w: o.w, h: o.h })),
    ...block.texts.map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })),
    ...block.stickers.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
    ...block.qrs.map((q) => ({ id: q.id, x: q.x, y: q.y, w: q.w, h: q.h })),
  ];
  const peersExcept = (id: string) => peerBoxes.filter((p) => p.id !== id);

  /**
   * THE SPREAD'S PAINT ORDER, across all four object families (`lib/builder/layers`).
   *
   * Handed to each `Movable` as its `zIndex`, which `Movable` has always accepted — so the canvas
   * shows the same stack the preview and the PDF will, without restructuring the four element
   * maps below (each carries genuinely different props) and without touching selection chrome,
   * dragging or the crop layers.
   */
  const layerZ = layerZIndexes(block);

  /**
   * THE STICKER BOX HUGS THE ARTWORK.
   *
   * A sticker is created with a pixel-SQUARE box whatever shape its artwork is, and drawn
   * `object-fit: contain` inside it — so a non-square sticker sat in a much larger box, and the
   * selection outline and the eight handles surrounded that box. This measures the artwork's real
   * aspect and tightens the box onto the rectangle the artwork is ALREADY drawn in: the picture
   * does not move or change size, only the empty margin goes. See `lib/builder/sticker-fit`.
   *
   * Written through `amendSticker` — a correction, not a second undo step. The returned aspects
   * also lock each sticker's RESIZE to its artwork (below), which is what keeps the box tight
   * through a corner drag instead of letting it come loose again.
   */
  const stickerAspects = useStickerBoxFit({
    stickers: block.stickers,
    urlFor: (id) => stickerUrlFor?.(id),
    containerAspect: pair,
    onFit: (id, box) => api.amendSticker(block.key, id, box),
  });
  /** The h = w × ratio a sticker's resize is locked to, or undefined until it is measured. */
  const stickerRatio = (stickerId: string) => {
    const url = stickerUrlFor?.(stickerId);
    const a = url ? stickerAspects.get(url) : undefined;
    return a ? stickerAspectRatio(a, pair) : undefined;
  };

  const leftPhoto = block.photoIds[0] ? photoMap.get(block.photoIds[0]) : undefined;
  const rightPhoto = block.photoIds[1] ? photoMap.get(block.photoIds[1]) : undefined;
  /**
   * Does this unit use base image slots at all? A non-empty base row means yes — a legacy page, a
   * panorama, or one a preset just laid out. An empty one is a plain page: background only, and
   * photos arrive as overlays. `clearBaseSlot` trims trailing holes, so removing the last base
   * photo returns a page to exactly that state.
   */
  const usesBaseSlots = block.photoIds.length > 0;

  /**
   * What this spread currently holds, said honestly. A frame with no photo in it is not "a photo
   * on this spread" — a new page starts with exactly one of those, and calling it a photo would
   * make the count disagree with the page, with the readiness panel and with the print gate.
   */
  const spreadSummary = (() => {
    const filled = block.overlays.filter((o) => o.photoId).length + block.photoIds.filter(Boolean).length;
    const empty = block.overlays.length - block.overlays.filter((o) => o.photoId).length;
    if (filled === 0 && empty === 0) return 'This spread is a blank page — drop a photo on it, or add a frame below';
    const parts: string[] = [];
    if (filled > 0) parts.push(`${filled} photo${filled === 1 ? '' : 's'}`);
    if (empty > 0) parts.push(`${empty} empty frame${empty === 1 ? '' : 's'} — drop a photo in`);
    return parts.join(' · ');
  })();

  const sel = (s: Selection) => selection.kind === s.kind && JSON.stringify(selection) === JSON.stringify(s);

  return (
    <div className="group/block">
      {/* Per-spread action bar — the explicit home for adding photos to this spread. */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{spreadSummary}</span>
        {/*
          ADD THE FRAME, THEN THE PHOTO — not the other way round.
          This used to open the photo picker and create nothing until something was chosen, which
          made "add a photo frame" impossible without already having decided which photo goes in
          it. The container is the thing being added; it is created empty, selected, and filled
          afterwards by dropping, by Replace on the toolbar, or from the tray.
        */}
        <button
          type="button"
          onClick={() => {
            const newId = api.addOverlay(block.key, null, 'center');
            if (newId) onSelect({ kind: 'overlay', id: newId });
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-studio/30 bg-card px-2.5 py-1.5 text-[12px] font-medium text-studio shadow-xs transition-all duration-150 ease-glide hover:border-studio/50 hover:bg-studio-soft active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <ImagePlus className="h-3.5 w-3.5" /> Add photo overlay
        </button>
      </div>

      {/*
        THE PASTEBOARD. A margin of working space around the page, so an element pushed past the
        trim edge has somewhere to sit and stays visible while you position it. It is scenery, not
        a container: it never clips, and nothing in it prints. A pointer-down out here means the
        same thing as one on an empty part of the page — deselect.
      */}
      <div
        className="relative"
        style={{ padding: `${PASTEBOARD_PCT}%` }}
        onPointerDown={() => onSelect({ kind: 'none' })}
        /* Capture phase: record WHERE the gesture landed before any element consumes it. */
        onPointerDownCapture={recordPoint}
      >
        {/* The page — premium paper with fold, shadow, page numbers, sharp printed corners. */}
        <div
          ref={(el) => {
            (pageRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            onPageEl?.(el);
          }}
          className="album-page relative w-full select-none"
          style={{ aspectRatio: pair, containerType: 'inline-size' }}
          /**
           * THE PAGE ITSELF IS NOT A PHOTO CONTAINER — but it is a drop TARGET.
           *
           * A page is a background; photos live in overlay frames the customer places. Dropping a
           * tray photo onto open paper therefore CREATES one of those frames, centred where it
           * landed, instead of filling a hidden slot that owns half the spread. Frames that can
           * accept a photo themselves (a base image, an existing overlay) stop the event, so this
           * only ever fires on bare paper.
           */
          onDragOver={acceptPhotoDrag}
          onDrop={(e) => {
            e.preventDefault();
            const id = readPhotoDrag(e);
            drag?.end();
            if (!id) return;
            const box = pageRef.current?.getBoundingClientRect();
            const at =
              box && box.width > 0 && box.height > 0
                ? { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }
                : undefined;
            const newId = api.addOverlay(block.key, id, at);
            if (newId) onSelect({ kind: 'overlay', id: newId });
          }}
        >
          {/* ── RENDER LAYER ────────────────────────────────────────────────────────────────
              EVERYTHING THAT DRAWS, CLIPPED AT THE TRIM. The page's own content was always
              geometrically pinned inside the box; what this clip adds is the free elements —
              an overlay, text, sticker or QR pushed past the edge is now cut exactly where the
              paper ends, live, while you drag it. That makes the canvas agree with the preview,
              the flipbook and the PDF by construction instead of by inspection.

              Movement is untouched: the gesture still travels out onto the pasteboard, and the
              handles that follow it live in the unclipped chrome layer below.

              `isolation: isolate` makes this a stacking context, which CONTAINS the object
              z-indexes (see `layerZ`). The trim ring, the adjustment ghost and the handle layer
              all sit OUTSIDE this element and must stay above everything inside it. */}
          <div className="absolute inset-0 overflow-hidden" style={{ isolation: 'isolate' }}>
          {block.background ? (
            <div className="absolute inset-0" style={backgroundStyle(block.background)} />
          ) : (
            <div className="absolute inset-0 bg-white" />
          )}

          {/*
            BASE IMAGE SLOTS — present only for a unit that USES them.

            A page created by the customer starts empty (`photoIds: []`) and stays that way: it is
            a background, and photos arrive as overlays. It therefore draws no slots at all, which
            is the visible half of "a page is not a photo container" — there is no full-page drop
            zone lying in wait, and nothing is attached to a new page automatically.

            A unit whose base row is NON-empty is one that genuinely works this way: a legacy
            album, a double-page panorama, or a page a layout preset / blueprint just filled. Those
            keep their slots — including an empty companion slot, so a half-filled preset is still
            finishable — and render exactly as they always have.
          */}
          {usesBaseSlots && (isDouble ? (
            <BaseSlotView
              photo={leftPhoto}
              /* A double-spread's single image is slot 0 — the same positional index the model,
                 the save and the crop target all use for it. */
              edit={resolveFrameEdit((block.baseEdits ?? [])[0], leftPhoto?.edit)}
              task={leftPhoto ? taskFor?.(leftPhoto.id) : undefined}
              label="Click or drop the image (spans both pages)"
              selected={sel({ kind: 'base', slot: 'image' })}
              pickActive={pickActive}
              onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('image') : undefined}
              onSelect={(mods) => selectResolved({ kind: 'base', blockKey: block.key, slot: 'image' }, mods)}
              onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'image' })}
              multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'image' })}
              onPick={() => setPicking({ kind: 'base', slot: 'image' })}
              onDrop={(id) => place(id, { slot: 'image' })}
              onDragEnterTarget={() => drag?.hover({ kind: 'frame', blockKey: block.key, slot: 'image' })}
              incomingPreviewUrl={(() => {
                const pid = drag?.incomingPhotoId({ kind: 'frame', blockKey: block.key, slot: 'image' });
                return pid ? (resolvePhotoUrl(photoMap.get(pid), 'full') ?? null) : null;
              })()}
              isDragSource={drag?.isSource(block.key, 'image')}
              onDragStartFrame={(photoId) =>
                drag?.begin({ photoIds: [photoId], origin: { from: 'frame', blockKey: block.key, slot: 'image' } })
              }
              onDragEndFrame={() => drag?.end()}
              onClear={() => api.clearBaseSlot(block.key, 'image')}
              onLongPress={
                onBeginCrop && leftPhoto?.status === 'ready' ? () => onBeginCrop({ slot: 'image', photoId: leftPhoto.id }) : undefined
              }
              onAdjust={
                onBeginCrop && leftPhoto?.status === 'ready' ? () => onBeginCrop({ slot: 'image', photoId: leftPhoto.id }) : undefined
              }
              onCrop={leftPhoto ? () => onQuickCrop(leftPhoto.id, pair, true, { slot: 'image' }) : undefined}
              onEdit={leftPhoto ? () => onEditPhoto(leftPhoto.id, { slot: 'image' }) : undefined}
              readiness={baseReadiness('image')}
              cropping={croppingSlot === 'image'}
              cropHandlers={cropHandlers}
            />
          ) : (
            <>
              <div className="absolute left-0 top-0 h-full w-1/2">
                <BaseSlotView
                  photo={leftPhoto}
                  edit={resolveFrameEdit((block.baseEdits ?? [])[0], leftPhoto?.edit)}
                  task={leftPhoto ? taskFor?.(leftPhoto.id) : undefined}
                  label="Left page"
                  selected={sel({ kind: 'base', slot: 'left' })}
                  pickActive={pickActive}
                  onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('left') : undefined}
                  onSelect={(mods) => selectResolved({ kind: 'base', blockKey: block.key, slot: 'left' }, mods)}
                  onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'left' })}
                  multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'left' })}
                  onPick={() => setPicking({ kind: 'base', slot: 'left' })}
                  onDrop={(id) => place(id, { slot: 'left' })}
                  onDragEnterTarget={() => drag?.hover({ kind: 'frame', blockKey: block.key, slot: 'left' })}
                  incomingPreviewUrl={(() => {
                    const pid = drag?.incomingPhotoId({ kind: 'frame', blockKey: block.key, slot: 'left' });
                    return pid ? (resolvePhotoUrl(photoMap.get(pid), 'full') ?? null) : null;
                  })()}
                  isDragSource={drag?.isSource(block.key, 'left')}
                  onDragStartFrame={(photoId) =>
                    drag?.begin({ photoIds: [photoId], origin: { from: 'frame', blockKey: block.key, slot: 'left' } })
                  }
                  onDragEndFrame={() => drag?.end()}
                  onClear={() => api.clearBaseSlot(block.key, 'left')}
                  onLongPress={
                    onBeginCrop && leftPhoto?.status === 'ready' ? () => onBeginCrop({ slot: 'left', photoId: leftPhoto.id }) : undefined
                  }
                  onAdjust={
                    onBeginCrop && leftPhoto?.status === 'ready' ? () => onBeginCrop({ slot: 'left', photoId: leftPhoto.id }) : undefined
                  }
                  onCrop={leftPhoto ? () => onQuickCrop(leftPhoto.id, page, false, { slot: 'left' }) : undefined}
                  onEdit={leftPhoto ? () => onEditPhoto(leftPhoto.id, { slot: 'left' }) : undefined}
                  readiness={baseReadiness('left')}
                  cropping={croppingSlot === 'left'}
                  cropHandlers={cropHandlers}
                />
              </div>
              <div className="absolute left-1/2 top-0 h-full w-1/2">
                <BaseSlotView
                  photo={rightPhoto}
                  edit={resolveFrameEdit((block.baseEdits ?? [])[1], rightPhoto?.edit)}
                  task={rightPhoto ? taskFor?.(rightPhoto.id) : undefined}
                  label="Right page"
                  selected={sel({ kind: 'base', slot: 'right' })}
                  pickActive={pickActive}
                  onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('right') : undefined}
                  onSelect={(mods) => selectResolved({ kind: 'base', blockKey: block.key, slot: 'right' }, mods)}
                  onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'right' })}
                  multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'right' })}
                  onPick={() => setPicking({ kind: 'base', slot: 'right' })}
                  onDrop={(id) => place(id, { slot: 'right' })}
                  onDragEnterTarget={() => drag?.hover({ kind: 'frame', blockKey: block.key, slot: 'right' })}
                  incomingPreviewUrl={(() => {
                    const pid = drag?.incomingPhotoId({ kind: 'frame', blockKey: block.key, slot: 'right' });
                    return pid ? (resolvePhotoUrl(photoMap.get(pid), 'full') ?? null) : null;
                  })()}
                  isDragSource={drag?.isSource(block.key, 'right')}
                  onDragStartFrame={(photoId) =>
                    drag?.begin({ photoIds: [photoId], origin: { from: 'frame', blockKey: block.key, slot: 'right' } })
                  }
                  onDragEndFrame={() => drag?.end()}
                  onClear={() => api.clearBaseSlot(block.key, 'right')}
                  onLongPress={
                    onBeginCrop && rightPhoto?.status === 'ready'
                      ? () => onBeginCrop({ slot: 'right', photoId: rightPhoto.id })
                      : undefined
                  }
                  onAdjust={
                    onBeginCrop && rightPhoto?.status === 'ready'
                      ? () => onBeginCrop({ slot: 'right', photoId: rightPhoto.id })
                      : undefined
                  }
                  onCrop={rightPhoto ? () => onQuickCrop(rightPhoto.id, page, false, { slot: 'right' }) : undefined}
                  onEdit={rightPhoto ? () => onEditPhoto(rightPhoto.id, { slot: 'right' }) : undefined}
                  readiness={baseReadiness('right')}
                  cropping={croppingSlot === 'right'}
                  cropHandlers={cropHandlers}
                />
              </div>
            </>
          ))}

          {/* Overlays (floating framed photos — or empty placeholder containers) */}
          {block.overlays.map((o) => {
            const photo = o.photoId ? photoMap.get(o.photoId) : undefined;
            // Stable client id (guaranteed by `useBlocks`). Used for the React key, for selection
            // and for every mutation, so reordering or deleting a sibling can no longer make a
            // stored reference point at a different overlay.
            const oid = o.id as string;
            return (
              <Movable
                key={oid}
                rect={o}
                zIndex={layerZ.get(oid)}
                selected={sel({ kind: 'overlay', id: oid }) || (isTargetSelected?.({ kind: 'overlay', blockKey: block.key, id: oid }) ?? false)}
                containerRef={pageRef}
                chromeContainer={chromeEl}
                escape={PASTEBOARD_ESCAPE}
                ariaLabel="Photo overlay"
                onSelect={(mods) => selectResolved({ kind: 'overlay', blockKey: block.key, id: oid }, mods ?? NO_MODS)}
                /* Hold the PHOTO to adjust it. An empty frame has nothing to adjust, and one
                   still processing has no sanitized master to author against — both simply have
                   no handler, so the hold falls through to ordinary behaviour. */
                onLongPress={
                  onBeginCrop && photo?.status === 'ready'
                    ? () => onBeginCrop({ overlayId: oid, photoId: photo.id })
                    : undefined
                }
                onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'overlay', blockKey: block.key, id: oid })}
                /* Only when there is a picture to adjust, and not while it is already being
                   adjusted — the crop surface is the affordance at that point. */
                centerControl={
                  onBeginCrop && photo?.status === 'ready' && croppingOverlay !== oid ? (
                    <AdjustHandle onAdjust={() => onBeginCrop({ overlayId: oid, photoId: photo.id })} />
                  ) : null
                }
                onChange={(r) => api.patchOverlays(block.key, block.overlays.map((ov) => (ov.id === oid ? { ...ov, ...r } : ov)))}
                onSnap={setSnap}
                peers={peersExcept(oid)}
                /* NO FRAME. An overlay is the photo itself — the white border, rounded corners
                   and drop shadow that used to live here were canvas decoration the customer never
                   asked for, and they printed. `overflow-hidden` stays because it is what clips the
                   image to the container; selection outline and handles come from `Movable`'s
                   chrome layer, so editing is untouched. Matches `_pair-frame` exactly, which is
                   what keeps the canvas and the PDF the same picture. */
                className="overflow-hidden"
                /**
                 * NO INLINE CONTROL BAR (Pass 2). Replace / edit / duplicate / layer / delete all
                 * live in the floating context bar now, which has room for the full photo toolset
                 * instead of the four buttons that fitted above an overlay. `Movable` still accepts
                 * `controls` — the cover canvas continues to use it, unchanged.
                 */
              >
                <OverlayContent
                  photo={photo}
                  /**
                   * THIS FRAME'S EDIT — the fix for "the crop commits but the canvas does not move".
                   *
                   * An adjustment is written to the PLACEMENT (`overlay.edit`) and inherited from
                   * the source photo until it forks. The read-only renderers and the cover canvas
                   * already resolved that; this canvas did not, and went on drawing
                   * `photo.edit` — the source row, which a placement crop never writes. So the
                   * value was correct everywhere except the surface the customer was dragging on.
                   */
                  edit={resolveFrameEdit(o.edit, photo?.edit)}
                  task={photo ? taskFor?.(photo.id) : undefined}
                  readiness={overlayReadiness(oid)}
                  cropping={croppingOverlay === oid}
                  cropHandlers={cropHandlers}
                  /* Same three drag hooks a base slot has, so an overlay previews an incoming
                     photo and reports its hover identically — see `place()`. */
                  onDropPhoto={(id) => place(id, { overlayId: oid })}
                  onDragEnterTarget={() => drag?.hover({ kind: 'frame', blockKey: block.key, overlayId: oid })}
                  incomingPreviewUrl={(() => {
                    const pid = drag?.incomingPhotoId({ kind: 'frame', blockKey: block.key, overlayId: oid });
                    return pid ? (resolvePhotoUrl(photoMap.get(pid), 'full') ?? null) : null;
                  })()}
                />
              </Movable>
            );
          })}

          {/* Text elements */}
          {block.texts.map((t) => (
            <Movable
              key={t.id}
              rect={t}
              zIndex={layerZ.get(t.id)}
              rotation={t.rotation}
              rotatable
              /* Matches what auto-fit can produce: a larger minimum would make the first pixel of
                 a corner drag jump a tightly-fitted box out to it. See MIN_TEXT_BOX. */
              minW={MIN_TEXT_BOX}
              minH={MIN_TEXT_BOX}
              selected={sel({ kind: 'text', id: t.id })}
              containerRef={pageRef}
              chromeContainer={chromeEl}
              escape={PASTEBOARD_ESCAPE}
              ariaLabel="Text"
              /**
               * BOTH STORES, ALWAYS. Text / sticker / QR used to update only the single-element
               * `selection` and leave the multi-select store holding whatever was picked before —
               * so selecting a text with an overlay still in that store made a Delete keystroke
               * act on the overlay. `SelectionTarget` has always had these kinds; they were simply
               * never wired. A plain click replaces, so the two stores now agree by construction.
               */
              onSelect={(mods) => selectResolved({ kind: 'text', blockKey: block.key, id: t.id }, mods ?? NO_MODS)}
              /* A CORNER drag scales the type with the box; a side handle reflows the words.
                 Either way the result is ONE ordinary patch, so the toolbar's size field, the
                 up/down steppers and this gesture all write the same property. */
              onChange={(r, ctx) => textResize.onChange(t, r, ctx)}
              onCommit={textResize.end}
              onRotate={(deg) => api.patchText(block.key, t.id, { rotation: deg })}
              onSnap={setSnap}
              peers={peersExcept(t.id)}
              /* Double-click still opens the inline editor — the canvas-first way to edit words.
                 Every other text action now lives in the context bar's Text toolbar. */
              onDoubleClick={() => setEditingText(t.id)}
            >
              {editingText === t.id ? (
                <InlineTextEditor
                  initial={t.text}
                  el={t}
                  onCommit={(text) => {
                    api.patchText(block.key, t.id, { text });
                    setEditingText(null);
                  }}
                />
              ) : (
                <TextContent el={t} />
              )}
              {/* Renders nothing: it measures the words and tightens the box around them. Held off
                  while the pointer owns the geometry, or while the words are still being typed. */}
              <TextAutoFit
                el={t}
                containerRef={pageRef}
                enabled={editingText !== t.id && textResize.resizingId !== t.id}
                onFit={(box) => api.amendText(block.key, t.id, box)}
              />
            </Movable>
          ))}

          {/* QR elements */}
          {block.qrs.map((q) => (
            <Movable
              key={q.id}
              rect={q}
              zIndex={layerZ.get(q.id)}
              keepSquare
              squareRatio={pair}
              minW={0.06}
              selected={sel({ kind: 'qr', id: q.id })}
              containerRef={pageRef}
              chromeContainer={chromeEl}
              escape={PASTEBOARD_ESCAPE}
              ariaLabel="QR code"
              onSelect={(mods) => selectResolved({ kind: 'qr', blockKey: block.key, id: q.id }, mods ?? NO_MODS)}
              onChange={(r) => api.patchQr(block.key, q.id, { ...r, h: squareQrHeight(r.w, pair) })}
              onSnap={setSnap}
              peers={peersExcept(q.id)}
            >
              <QrContent el={q} />
            </Movable>
          ))}

          {/* Stickers */}
          {block.stickers.map((s) => (
            <Movable
              key={s.id}
              rect={s}
              zIndex={layerZ.get(s.id)}
              /* THE RESIZE IS LOCKED TO THE ARTWORK'S ASPECT — the same primitive the QR code uses
                 to stay pixel-square, with the artwork's ratio instead of 1:1. Without it a corner
                 drag would re-letterbox the sticker and the outline would come loose again on the
                 very next gesture. Absent until measured, which simply leaves the old free
                 resize in place for that render. */
              keepSquare={stickerRatio(s.stickerId) !== undefined}
              squareRatio={stickerRatio(s.stickerId)}
              rotation={s.rotation}
              rotatable
              locked={s.locked}
              minW={0.04}
              minH={0.04}
              selected={sel({ kind: 'sticker', id: s.id })}
              containerRef={pageRef}
              chromeContainer={chromeEl}
              escape={PASTEBOARD_ESCAPE}
              ariaLabel="Sticker"
              onSelect={(mods) => selectResolved({ kind: 'sticker', blockKey: block.key, id: s.id }, mods ?? NO_MODS)}
              onChange={(r) => api.patchSticker(block.key, s.id, r)}
              onRotate={(deg) => api.patchSticker(block.key, s.id, { rotation: deg })}
              onSnap={setSnap}
              peers={peersExcept(s.id)}
            >
              <StickerContent el={s} url={stickerUrlFor?.(s.stickerId)} />
            </Movable>
          ))}

          {/*
            THE TRIM REFERENCE — always on, and the one guide every customer needs.

            The page rectangle drawn here IS the 206 × 291 mm artwork (bleed) area: the export
            scales this design to fill exactly that box. The dotted rectangle is the 200 × 285 mm
            that survives the printer's cut, so the 3 mm ring outside it is the bleed — paper that
            is printed and then trimmed away.

            Inset by `INTERIOR_TRIM_INSET_FRACTION` (3/206 and 3/291) rather than a hand-picked
            percentage, so the guide and the printed sheet are the same geometry. Client-only and
            inert; it is never exported, never saved, and cannot be selected.
          */}
          <TrimGuides />

          {/*
            THE 15 MM IMPORTANT-CONTENT BOUNDARY — behind the existing Show guides toggle.

            A second, quieter rectangle inside the trim: faces, horizons and text should stay
            within it, because the gutter and the binding eat the edge. It used to be drawn at
            4%/6% of the page, numbers that corresponded to nothing physical; it is now the real
            15 mm, measured from the trim edge, from the same specification the exporter uses.
          */}
          {showGuides && <SafeAreaGuides />}

          {/* The physical fold. Same component the preview, review and flat-spread views use, so
              the gutter a customer designs around is the gutter they are shown everywhere. */}
          {showGutter && <PrintGutter />}

          {/* Page numbers */}
          {/* Above the object band — see `LAYER_CHROME_Z`. These used to sit at z-7 and win by
              default, because objects carried no z-index at all. */}
          <span
            className="pointer-events-none absolute bottom-2 left-3 text-[10px] font-medium tabular-nums text-foreground/35"
            style={{ zIndex: LAYER_CHROME_Z }}
          >
            {start}
          </span>
          <span
            className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-medium tabular-nums text-foreground/35"
            style={{ zIndex: LAYER_CHROME_Z }}
          >
            {start + cost - 1}
          </span>
          </div>
          {/* ── end of the clipped render layer ─────────────────────────────────────────── */}

          {/*
            THE TRIM EDGE. The clip already cuts content here, so this hairline names the cut:
            it is the answer to "where does the paper actually end?" for the part of an element
            that vanished. Above the render layer, below the chrome, so it never fights the
            handles you are working with.
          */}
          <span aria-hidden className="pointer-events-none absolute inset-0 z-[10] ring-1 ring-inset ring-foreground/[0.09]" />

          {/* THE ADJUSTMENT GHOST. Outside the clipped render layer for the same reason the
              handles are: the part of the photo that spills past the frame has to be visible to
              be aimed at. Inert — the capture surface stays inside the frame. */}
          {cropFrame && cropUrl && (
            <CropBleed rect={cropFrame.rect} rounded={cropFrame.rounded} url={cropUrl} edit={cropEdit} />
          )}

          {/* ── EDITING LAYER ───────────────────────────────────────────────────────────────
              Selection chrome only — outlines, handles, and the ghost that stands in for an
              element pushed fully off the paper. Deliberately OUTSIDE the clip so all of that
              survives out on the pasteboard, and `pointer-events-none` so it never steals a
              click from the page underneath; the handles re-enable pointer events themselves. */}
          <div ref={setChromeEl} className="pointer-events-none absolute inset-0 z-[30]" />

          {/* Snap guides while dragging — chrome too, so they read across the full spread. */}
          <SnapGuides lines={snap} />
        </div>

        {/*
          WHAT THE DOTTED LINE MEANS.

          A guide nobody can read is decoration, so the trim rectangle says what it is — once,
          quietly, in the pasteboard directly beneath the page. It sits INSIDE the pasteboard the
          card already reserves, so it costs the workspace-fit budget nothing and the book does
          not shrink to make room for it.

          Deliberately precise about which boundary this is: the paper printed is the whole sheet,
          and the dotted line is where it gets CUT. Saying "only this area is printed" would be
          the wrong sentence about the wrong rectangle.
        */}
        <p
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-1 select-none text-center text-[10px] font-medium leading-tight text-muted-foreground/70 sm:text-[11px]"
        >
          {TRIM_GUIDE_CAPTION}
        </p>
      </div>

      {picking && (
        <PhotoPicker
          title={
            picking.kind === 'base'
              ? picking.slot === 'image'
                ? 'Choose the spread image'
                : `Choose the ${picking.slot} page photo`
              : 'Replace overlay photo'
          }
          available={availablePhotos}
          onPick={(id) => {
            if (picking.kind === 'base') place(id, { slot: picking.slot });
            else place(id, { overlayId: picking.overlayId });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}


function OverlayContent({
  photo,
  /**
   * THE EDIT THIS FRAME RENDERS — its own placement edit, or the source photo's when it has not
   * forked (see PLACEMENT EDITS in `lib/builder/model`).
   *
   * It is a PROP rather than `photo.edit` because the two stopped being the same thing when one
   * image became placeable many times: a crop is written to the container, so reading it off the
   * `photos` row shows the source's framing and never moves while the customer drags. That was
   * exactly the "crop commits correctly but the canvas does not update" defect — the shared
   * renderers resolved it, this canvas did not.
   */
  edit,
  task,
  readiness,
  cropping,
  cropHandlers,
  incomingPreviewUrl,
  onDragEnterTarget,
  onDropPhoto,
}: {
  photo?: Photo;
  edit?: EditConfig | null;
  task?: UploadTask;
  readiness?: Readiness;
  cropping?: boolean;
  cropHandlers?: CropHandlers;
  /** Smart Replace: the photo that would land here if dropped now. Null when not hovering. */
  incomingPreviewUrl?: string | null;
  /** The pointer entered this overlay during a drag — publishes the hover to the drag store. */
  onDragEnterTarget?: () => void;
  onDropPhoto: (photoId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const uiState = photo ? photoUiState(photo, task) : 'ready';
  return (
    <div
      /* An occupied overlay is as valid a target as an empty one — dropping onto it replaces.
         See `photo-dnd`: the effect must be declared identically on both sides or the browser
         cancels the drop before any handler runs. */
      onDragOver={(e) => {
        acceptPhotoDrag(e);
        if (!over) {
          setOver(true);
          onDragEnterTarget?.();
        }
      }}
      onDragLeave={(e) => {
        if (leftDropTarget(e)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = readPhotoDrag(e);
        if (id) onDropPhoto(id);
      }}
      className="relative h-full w-full"
    >
      {photo ? (
        <>
          <div className={`h-full w-full ${stateOpacityClass(uiState)} ${incomingPreviewUrl ? 'opacity-30' : ''}`}>
            <PhotoFrame url={resolvePhotoUrl(photo, 'full') ?? ''} edit={edit ?? photo.edit} alt="overlay" />
          </div>
          {/* THE REPLACEMENT PREVIEW, exactly as a base slot draws it: the incoming photo
              rendered in place through the same `PhotoFrame`, inert so it can never intercept
              the drop. An overlay is a frame like any other — it should answer "what will this
              look like?" with the picture, not with a word. */}
          {incomingPreviewUrl && (
            <div className="pointer-events-none absolute inset-0 z-[5] motion-safe:animate-fade-in">
              <PhotoFrame url={incomingPreviewUrl} alt="" />
            </div>
          )}
          <UploadBadge state={uiState} progress={task?.progress} size="compact" />
          {!incomingPreviewUrl && <ReadinessBadge readiness={readiness} size="compact" />}
          {cropping && <CropLayer handlers={cropHandlers} />}
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-studio/40 bg-studio-soft/60 text-center">
          <ImagePlus className="h-4 w-4 text-studio/70" />
          <span className="px-1 text-[10px] font-medium leading-tight text-studio/80">Empty overlay — drop a photo</span>
        </div>
      )}
      {/* Drop feedback: a filled overlay shows a clear "Replace" affordance so the user knows the
          drop will swap the existing photo; an empty one just glows as a valid target. The tint is
          dropped once the incoming photo is previewing underneath — muddying the answer to "what
          will this look like?" with a wash of accent colour defeats the preview. */}
      {over && (
        <div
          className={`pointer-events-none absolute inset-0 z-[6] flex items-end justify-center pb-1.5 ring-2 ring-inset ring-studio-bright ${
            incomingPreviewUrl ? '' : 'bg-studio/15'
          }`}
        >
          {photo && (
            <span className="rounded-full bg-studio px-2 py-0.5 text-[10px] font-semibold text-studio-foreground shadow-sm">Replace</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Base slot ─────────────────────────────────────────────────────────────────────
function BaseSlotView({
  photo,
  /** The edit THIS SLOT renders — see the same prop on `OverlayContent`. */
  edit,
  task,
  label,
  selected,
  multiSelected,
  incomingPreviewUrl,
  isDragSource,
  onDragEnterTarget,
  onDragStartFrame,
  onDragEndFrame,
  pickActive = false,
  onTapPlace,
  onSelect,
  onContextMenu,
  onPick,
  onDrop,
  onClear,
  onCrop,
  onEdit,
  onLongPress,
  onAdjust,
  readiness,
  cropping,
  cropHandlers,
}: {
  photo?: Photo;
  edit?: EditConfig | null;
  task?: UploadTask;
  label: string;
  selected: boolean;
  /** Print readiness for this frame (Phase 7). Draws nothing unless it says something. */
  readiness?: Readiness;
  /** This base slot is in in-canvas crop mode (Pass 2). */
  cropping?: boolean;
  cropHandlers?: CropHandlers;
  /** Part of a multi-selection (Phase 6) — drawn with the same ring as the tray. */
  multiSelected?: boolean;
  /** Smart Replace: the photo that would land here if dropped now. Null when not hovering. */
  incomingPreviewUrl?: string | null;
  /** This frame is where the current drag STARTED — dim it so the move reads as a move. */
  isDragSource?: boolean;
  /** The pointer entered this frame during a drag — publishes the hover to the drag store. */
  onDragEnterTarget?: () => void;
  /** A filled frame began a drag — publishes the payload so destinations can preview it. */
  onDragStartFrame?: (photoId: string) => void;
  onDragEndFrame?: () => void;
  pickActive?: boolean;
  onTapPlace?: () => void;
  /** Receives the modifier state so the SELECTION STORE decides what a modifier means. */
  onSelect: (mods: SelectMods) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onPick: () => void;
  onDrop: (photoId: string) => void;
  onClear: () => void;
  onCrop?: () => void;
  onEdit?: () => void;
  /** Press and hold this photo → image adjustment. Same action the toolbar's Crop button runs. */
  onLongPress?: () => void;
  /**
   * Enter image adjustment on this slot — the centre handle's action. A page photo is adjusted the
   * same way a floating one is, so it gets the same affordance rather than a quieter version of it.
   */
  onAdjust?: () => void;
}) {
  const [over, setOver] = useState(false);
  /**
   * The SAME recogniser the overlay's `Movable` uses, so a hold feels identical on a page half
   * and on a floating frame. There is no drag to arbitrate here — a base slot is moved by HTML
   * drag-and-drop, not by pointer maths — so arming and cancelling is all this surface needs.
   */
  const press = useLongPress(onLongPress);
  const tapToPlace = pickActive && !photo && !!onTapPlace;
  const uiState = photo ? photoUiState(photo, task) : 'ready';
  // Crop + edit are authored against the worker's sanitized master, so they wait for it.
  const editable = !!photo && photo.status === 'ready';

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        if (photo) onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
        press.arm(e);
      }}
      onPointerMove={press.track}
      onPointerUp={press.cancel}
      onPointerCancel={press.cancel}
      onPointerLeave={press.cancel}
      onContextMenu={(e) => {
        e.stopPropagation();
        // A hold that already opened adjustment must not also open the menu some browsers
        // synthesise from it — one gesture, one outcome.
        if (press.consumeFired()) {
          e.preventDefault();
          return;
        }
        onContextMenu?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (tapToPlace) onTapPlace?.();
        else if (!photo) onPick();
        else onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (photo && onEdit && editable) onEdit();
      }}
      /**
       * A FILLED slot is itself draggable, which is what makes page→page and page→tray moves
       * possible. The payload is the same `text/photo-id` every drop handler already reads, so
       * the destination logic is unchanged — only the set of possible sources grew.
       */
      draggable={!!photo}
      onDragStart={(e) => {
        if (!photo) return;
        e.stopPropagation();
        // An HTML drag has begun, so the gesture is unambiguously a move; `pointermove` does not
        // fire during a native drag, so the slop test would never cancel the press on its own.
        press.cancel();
        startPhotoDrag(e, photo.id);
        onDragStartFrame?.(photo.id);
      }}
      onDragEnd={() => onDragEndFrame?.()}
      /* Occupied or empty, this slot accepts the drop — a photo landing on a filled slot is a
         replacement, which is a legitimate outcome and must not be refused by the browser. */
      onDragOver={(e) => {
        acceptPhotoDrag(e);
        if (!over) {
          setOver(true);
          onDragEnterTarget?.();
        }
      }}
      onDragLeave={(e) => {
        if (leftDropTarget(e)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        // The page turns a bare drop into a NEW overlay; a drop that landed in this slot means
        // this slot, so it must not bubble on and create a second frame on top of it.
        e.stopPropagation();
        setOver(false);
        const id = readPhotoDrag(e);
        if (id) onDrop(id);
      }}
      className={`group/base absolute inset-0 cursor-pointer transition-all duration-200 ${
        over ? 'ring-2 ring-inset ring-studio-bright' : tapToPlace ? 'ring-2 ring-inset ring-studio-bright/70' : ''
      } ${selected ? 'ring-2 ring-inset ring-studio-bright' : multiSelected ? 'ring-2 ring-inset ring-studio' : ''}`}
    >
{/* The centre affordance, from the SLOT's box — unaffected by the crop inside it. It is not
          drawn while adjusting, because the adjustment surface is the affordance then. */}
      {selected && onAdjust && editable && !cropping && (
        <div className="pointer-events-none absolute inset-0 z-[8] grid place-items-center">
          <AdjustHandle onAdjust={onAdjust} />
        </div>
      )}
      {photo ? (
        <>
          <div
            className={`h-full w-full transition-opacity duration-200 ${stateOpacityClass(uiState)} ${
              // SMART REPLACE: the outgoing photo dims so the incoming one reads clearly, and the
              // SOURCE of a page→page move dims too, so it's obvious the photo is being taken.
              incomingPreviewUrl ? 'opacity-30' : isDragSource ? 'opacity-40' : ''
            }`}
          >
            <PhotoFrame url={resolvePhotoUrl(photo, 'full') ?? ''} edit={edit ?? photo.edit} alt={photo.filename} />
          </div>

          {/*
            THE REPLACEMENT PREVIEW. The incoming photo is rendered in place, at the destination's
            own geometry, fading in over the one it would replace — so the answer to "what will
            this look like?" is the picture itself rather than a label. It is inert (`pointer-
            events-none`) so it can never intercept the drop, and it uses the SAME `PhotoFrame` as
            everything else, so crop/rotate/filters are honoured exactly as they will be after the
            drop. Nothing is committed until the user actually releases.
          */}
          {incomingPreviewUrl && (
            <div className="pointer-events-none absolute inset-0 z-[5] motion-safe:animate-fade-in">
              <PhotoFrame url={incomingPreviewUrl} alt="" />
            </div>
          )}

          {/* An optimistic photo on the page says so quietly — the photo stays the hero. */}
          <span className="z-[6]">
            <UploadBadge state={uiState} progress={task?.progress} size="compact" />
          </span>
          {/* Bottom-left, so it never collides with the upload pill (top-left) or the slot
              controls (top-right). Hidden mid-drag — a drop preview shouldn't be judged. */}
          {!incomingPreviewUrl && !isDragSource && <ReadinessBadge readiness={readiness} size="compact" />}
          {cropping && <CropLayer handlers={cropHandlers} />}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[6] h-14 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity duration-200 group-hover/base:opacity-100" />
          {/* Filled base slot: dropping REPLACES the current photo — name it, once, small. */}
          {over && (
            <div className="pointer-events-none absolute inset-0 z-[6] flex items-end justify-center pb-2 ring-2 ring-inset ring-studio-bright">
              <span className="rounded-full bg-studio px-2.5 py-0.5 text-[11px] font-semibold text-studio-foreground shadow-sm">
                Replace
              </span>
            </div>
          )}
          <div className="absolute right-1.5 top-1.5 z-[7] flex gap-1 opacity-0 transition-all duration-200 group-hover/base:opacity-100">
            {/* Crop/adjust geometry is authored against the WORKER'S master, so both stay
                gated until it exists — with the reason on the control itself. */}
            {onEdit && (
              <SlotBtn label={editable ? 'Edit photo' : 'Editing available once processing finishes'} disabled={!editable} onClick={onEdit}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </SlotBtn>
            )}
            {onCrop && (
              <SlotBtn label={editable ? 'Adjust crop' : 'Cropping available once processing finishes'} disabled={!editable} onClick={onCrop}>
                <Crop className="h-3.5 w-3.5" />
              </SlotBtn>
            )}
            <SlotBtn label="Remove photo" destructive onClick={onClear}>
              <X className="h-3.5 w-3.5" />
            </SlotBtn>
          </div>
        </>
      ) : (
        <div
          className={`flex h-full w-full flex-col items-center justify-center gap-2.5 px-3 text-center transition-colors duration-200 ${
            over ? 'bg-studio-soft' : 'bg-transparent'
          }`}
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed transition-all duration-200 ${
              over
                ? 'scale-105 border-studio-bright bg-studio/10 text-studio'
                : 'border-foreground/15 text-foreground/40 group-hover/base:-translate-y-0.5 group-hover/base:border-studio-bright/50 group-hover/base:bg-studio-soft group-hover/base:text-studio'
            }`}
          >
            <ImagePlus className="h-5 w-5" />
          </span>
          <span
            className={`text-xs font-medium tracking-tight transition-colors duration-200 ${
              over ? 'text-studio' : 'text-foreground/55 group-hover/base:text-foreground'
            }`}
          >
            {over ? 'Drop to place' : tapToPlace ? 'Tap to place here' : label}
          </span>
        </div>
      )}
    </div>
  );
}

function SlotBtn({
  label,
  onClick,
  destructive,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  /** Kept visible but inert — the label explains why, which is the point of gating. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      className={`rounded-lg bg-background/90 p-1.5 shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed text-muted-foreground/50'
          : destructive
            ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
            : 'text-foreground hover:bg-studio hover:text-studio-foreground'
      }`}
    >
      {children}
    </button>
  );
}

// ── Photo picker (base / overlay replace) ─────────────────────────────────────────
/**
 * Exported (Pass 2) so the floating toolbar's "Replace" opens the SAME picker the canvas has
 * always used, hosted by the builder rather than by this component's local state. One picker,
 * two triggers — not a second implementation living next to the toolbar.
 */
export function PhotoPicker({
  title,
  available,
  onPick,
  onClose,
}: {
  title: string;
  available: Photo[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-rise w-full max-w-lg rounded-2xl border bg-background p-4 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {available.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            All photos are already placed. Free one up or upload more.
          </p>
        ) : (
          <div className="mt-3 grid max-h-[60vh] grid-cols-3 gap-2.5 overflow-y-auto p-0.5 sm:grid-cols-4">
            {available.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                title={p.filename}
                className="relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-studio-bright/60"
              >
                <PhotoFrame url={resolvePhotoUrl(p, 'full') ?? ''} edit={p.edit} alt={p.filename} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
