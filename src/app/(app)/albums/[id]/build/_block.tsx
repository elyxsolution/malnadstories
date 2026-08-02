'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Crop, SlidersHorizontal, ImagePlus } from 'lucide-react';
import PhotoFrame from './_photo-frame';
import Movable, { SnapGuides, type SnapLine, type SelectMods } from './_movable';
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
import { PAGE_COST, physicalStart, type Block } from '@/lib/builder/model';
import { PASTEBOARD_PCT, PASTEBOARD_ESCAPE } from '@/lib/builder/edit-bounds';
import { hitStack, isSamePoint, resolveHit, type HitPoint, type HitTarget } from '@/lib/builder/hit-test';
import { acceptPhotoDrag, leftDropTarget, readPhotoDrag, startPhotoDrag } from '@/lib/builder/photo-dnd';
import { useBuilderDimensions } from './_dimensions';
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
  onEditPhoto: (photoId: string) => void;
  onQuickCrop: (photoId: string, frameAspect: number, showGutter: boolean) => void;
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

  // Which frame on THIS spread is being cropped — resolved once rather than per frame.
  const cropOnThisBlock = cropTarget && cropTarget.blockKey === block.key ? cropTarget : null;
  const croppingSlot = cropOnThisBlock?.slot ?? null;
  const croppingOverlay = cropOnThisBlock?.overlayId ?? null;
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [picking, setPicking] = useState<
    { kind: 'base'; slot: BaseSlot } | { kind: 'replace'; overlayId: string } | { kind: 'overlay-add' } | null
  >(null);

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

  const leftPhoto = block.photoIds[0] ? photoMap.get(block.photoIds[0]) : undefined;
  const rightPhoto = block.photoIds[1] ? photoMap.get(block.photoIds[1]) : undefined;

  const sel = (s: Selection) => selection.kind === s.kind && JSON.stringify(selection) === JSON.stringify(s);

  return (
    <div className="group/block">
      {/* Per-spread action bar — the explicit home for adding floating photo overlays. */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {block.overlays.length > 0
            ? `${block.overlays.length} overlay${block.overlays.length === 1 ? '' : 's'} on this spread`
            : 'Tip: add framed photo overlays on top of the page'}
        </span>
        <button
          type="button"
          onClick={() => setPicking({ kind: 'overlay-add' })}
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
        >
          {/* ── RENDER LAYER ────────────────────────────────────────────────────────────────
              EVERYTHING THAT DRAWS, CLIPPED AT THE TRIM. The page's own content was always
              geometrically pinned inside the box; what this clip adds is the free elements —
              an overlay, text, sticker or QR pushed past the edge is now cut exactly where the
              paper ends, live, while you drag it. That makes the canvas agree with the preview,
              the flipbook and the PDF by construction instead of by inspection.

              Movement is untouched: the gesture still travels out onto the pasteboard, and the
              handles that follow it live in the unclipped chrome layer below. */}
          <div className="absolute inset-0 overflow-hidden">
          {block.background ? (
            <div className="absolute inset-0" style={backgroundStyle(block.background)} />
          ) : (
            <div className="absolute inset-0 bg-white" />
          )}

          {/* Base photo slots */}
          {isDouble ? (
            <BaseSlotView
              photo={leftPhoto}
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
              onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], pair, true) : undefined}
              onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
              readiness={baseReadiness('image')}
              cropping={croppingSlot === 'image'}
              cropHandlers={cropHandlers}
            />
          ) : (
            <>
              <div className="absolute left-0 top-0 h-full w-1/2">
                <BaseSlotView
                  photo={leftPhoto}
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
                  onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], page, false) : undefined}
                  onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
                  readiness={baseReadiness('left')}
                  cropping={croppingSlot === 'left'}
                  cropHandlers={cropHandlers}
                />
              </div>
              <div className="absolute left-1/2 top-0 h-full w-1/2">
                <BaseSlotView
                  photo={rightPhoto}
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
                  onCrop={rightPhoto ? () => onQuickCrop(block.photoIds[1], page, false) : undefined}
                  onEdit={rightPhoto ? () => onEditPhoto(block.photoIds[1]) : undefined}
                  readiness={baseReadiness('right')}
                  cropping={croppingSlot === 'right'}
                  cropHandlers={cropHandlers}
                />
              </div>
            </>
          )}

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
                selected={sel({ kind: 'overlay', id: oid }) || (isTargetSelected?.({ kind: 'overlay', blockKey: block.key, id: oid }) ?? false)}
                containerRef={pageRef}
                chromeContainer={chromeEl}
                escape={PASTEBOARD_ESCAPE}
                ariaLabel="Photo overlay"
                onSelect={(mods) => selectResolved({ kind: 'overlay', blockKey: block.key, id: oid }, mods ?? NO_MODS)}
                onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'overlay', blockKey: block.key, id: oid })}
                onChange={(r) => api.patchOverlays(block.key, block.overlays.map((ov) => (ov.id === oid ? { ...ov, ...r } : ov)))}
                onSnap={setSnap}
                peers={peersExcept(oid)}
                className="overflow-hidden rounded-md border-2 border-white shadow-md"
                /**
                 * NO INLINE CONTROL BAR (Pass 2). Replace / edit / duplicate / layer / delete all
                 * live in the floating context bar now, which has room for the full photo toolset
                 * instead of the four buttons that fitted above an overlay. `Movable` still accepts
                 * `controls` — the cover canvas continues to use it, unchanged.
                 */
              >
                <OverlayContent
                  photo={photo}
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
              rotation={t.rotation}
              rotatable
              minW={0.06}
              minH={0.03}
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
              onChange={(r) => api.patchText(block.key, t.id, r)}
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
            </Movable>
          ))}

          {/* QR elements */}
          {block.qrs.map((q) => (
            <Movable
              key={q.id}
              rect={q}
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

          {/* Guides — margins + safe-zone + bleed (client-only; never printed). */}
          {showGuides && (
            <div className="pointer-events-none absolute inset-0 z-[8]">
              <div className="absolute inset-[1.5%] border border-dashed border-destructive/40" />
              <div className="absolute left-[4%] top-[6%] h-[88%] w-[42%] border border-dashed border-studio/45" />
              <div className="absolute right-[4%] top-[6%] h-[88%] w-[42%] border border-dashed border-studio/45" />
            </div>
          )}

          {/* The physical fold. Same component the preview, review and flat-spread views use, so
              the gutter a customer designs around is the gutter they are shown everywhere. */}
          {showGutter && <PrintGutter />}

          {/* Page numbers */}
          <span className="pointer-events-none absolute bottom-2 left-3 z-[7] text-[10px] font-medium tabular-nums text-foreground/35">
            {start}
          </span>
          <span className="pointer-events-none absolute bottom-2 right-3 z-[7] text-[10px] font-medium tabular-nums text-foreground/35">
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

          {/* ── EDITING LAYER ───────────────────────────────────────────────────────────────
              Selection chrome only — outlines, handles, and the ghost that stands in for an
              element pushed fully off the paper. Deliberately OUTSIDE the clip so all of that
              survives out on the pasteboard, and `pointer-events-none` so it never steals a
              click from the page underneath; the handles re-enable pointer events themselves. */}
          <div ref={setChromeEl} className="pointer-events-none absolute inset-0 z-[30]" />

          {/* Snap guides while dragging — chrome too, so they read across the full spread. */}
          <SnapGuides lines={snap} />
        </div>
      </div>

      {picking && (
        <PhotoPicker
          title={
            picking.kind === 'base'
              ? picking.slot === 'image'
                ? 'Choose the spread image'
                : `Choose the ${picking.slot} page photo`
              : picking.kind === 'replace'
                ? 'Replace overlay photo'
                : 'Add a photo overlay'
          }
          available={availablePhotos}
          onPick={(id) => {
            if (picking.kind === 'base') place(id, { slot: picking.slot });
            else if (picking.kind === 'replace') place(id, { overlayId: picking.overlayId });
            else {
              // `addOverlay` appends, so the new overlay's id is discoverable from the block
              // only after the mutation commits. Minting it here keeps selection immediate and
              // correct without reaching back into state.
              const newId = api.addOverlay(block.key, id);
              if (newId) onSelect({ kind: 'overlay', id: newId });
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

// ── Overlay content ─────────────────────────────────────────────────────────────────
/**
 * The inside of one overlay container. Renders the assigned photo, or — when empty — a dashed
 * placeholder that reads as a real drop zone. Accepts a dragged tray photo (`text/photo-id`)
 * exactly like a base slot, so a user fills a placeholder overlay by dragging onto it. Dropping
 * onto a filled overlay replaces its photo. The parent Movable still handles select/drag/resize.
 */
/** The pointer/keyboard surface `useCanvasCrop` supplies. Passed straight through to the layer. */
export type CropHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/**
 * IN-CANVAS CROP LAYER — a transparent capture surface laid over the frame being cropped.
 *
 * It draws nothing but affordance: a bright boundary saying "this is what will print", a
 * rule-of-thirds grid to compose against, and a dimming scrim over everything else on the page
 * (rendered by the caller) so the frame is unmistakably the subject. The photo underneath is the
 * live preview — it is the SAME `PhotoFrame` as always, re-rendering from the same `EditConfig`
 * the drag is mutating, so what you drag is exactly what prints.
 *
 * It takes focus on mount so arrow keys nudge and Escape finishes without touching the mouse.
 */
function CropLayer({ handlers }: { handlers?: CropHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      role="application"
      aria-label="Crop: drag to reposition, scroll or +/− to zoom, Escape to finish"
      tabIndex={0}
      onPointerDown={handlers?.onPointerDown}
      onPointerMove={handlers?.onPointerMove}
      onPointerUp={handlers?.onPointerUp}
      onPointerCancel={handlers?.onPointerUp}
      onWheel={handlers?.onWheel}
      onKeyDown={handlers?.onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-[9] cursor-move touch-none select-none outline-none ring-2 ring-inset ring-studio-bright"
    >
      {/* Rule of thirds — the one compositional aid worth drawing while repositioning. */}
      <span aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/45" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/45" />
        <span className="absolute inset-x-0 top-1/3 h-px bg-white/45" />
        <span className="absolute inset-x-0 top-2/3 h-px bg-white/45" />
      </span>
    </div>
  );
}

function OverlayContent({
  photo,
  task,
  readiness,
  cropping,
  cropHandlers,
  incomingPreviewUrl,
  onDragEnterTarget,
  onDropPhoto,
}: {
  photo?: Photo;
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
            <PhotoFrame url={resolvePhotoUrl(photo, 'full') ?? ''} edit={photo.edit} alt="overlay" />
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
  readiness,
  cropping,
  cropHandlers,
}: {
  photo?: Photo;
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
}) {
  const [over, setOver] = useState(false);
  const tapToPlace = pickActive && !photo && !!onTapPlace;
  const uiState = photo ? photoUiState(photo, task) : 'ready';
  // Crop + edit are authored against the worker's sanitized master, so they wait for it.
  const editable = !!photo && photo.status === 'ready';

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        if (photo) onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
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
        setOver(false);
        const id = readPhotoDrag(e);
        if (id) onDrop(id);
      }}
      className={`group/base absolute inset-0 cursor-pointer transition-all duration-200 ${
        over ? 'ring-2 ring-inset ring-studio-bright' : tapToPlace ? 'ring-2 ring-inset ring-studio-bright/70' : ''
      } ${selected ? 'ring-2 ring-inset ring-studio-bright' : multiSelected ? 'ring-2 ring-inset ring-studio' : ''}`}
    >
      {photo ? (
        <>
          <div
            className={`h-full w-full transition-opacity duration-200 ${stateOpacityClass(uiState)} ${
              // SMART REPLACE: the outgoing photo dims so the incoming one reads clearly, and the
              // SOURCE of a page→page move dims too, so it's obvious the photo is being taken.
              incomingPreviewUrl ? 'opacity-30' : isDragSource ? 'opacity-40' : ''
            }`}
          >
            <PhotoFrame url={resolvePhotoUrl(photo, 'full') ?? ''} edit={photo.edit} alt={photo.filename} />
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
