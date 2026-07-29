'use client';

import { useRef, useState } from 'react';
import {
  X,
  Replace,
  Crop,
  SlidersHorizontal,
  Copy,
  Pencil,
  ImagePlus,
} from 'lucide-react';
import PhotoFrame from './_photo-frame';
import Movable, { SnapGuides, type SnapLine } from './_movable';
import { TextContent, QrContent, StickerContent } from './_elements-render';
import { ElementControls, CtlBtn, InlineTextEditor } from './_element-bits';
import type { Photo } from '@/lib/builder/photo';
import type { UploadTask } from '@/lib/uploads';
import { photoUiState } from './_photo-state';
import UploadBadge, { stateOpacityClass } from './_upload-badge';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import { backgroundStyle, squareQrHeight } from '@/lib/builder/elements';
import { PAGE_COST, physicalStart, type Block } from '@/lib/builder/model';
import { useBuilderDimensions } from './_dimensions';
import type { BuilderApi, BaseSlot, Selection } from './_use-builder';
import type { DragApi } from './_use-drag';
import type { SelectionTarget } from './_selection-model';
import ReadinessBadge from './_readiness-badge';
import { frameKey, type Readiness } from './_quality-model';

/**
 * The premium open-book editing canvas for ONE spread (open pair, 3:2). Renders the page
 * with a centre fold, soft paper shadow, page numbers, optional guides, and every editable
 * element — base photos, floating photo overlays, text, and QR — each selectable, draggable,
 * resizable (and text rotatable) through the shared `Movable` engine. All mutations flow
 * through the builder hook (`api`), so persistence is unchanged.
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
  stickerUrlFor,
  pickActive = false,
  onTapPlaceBase,
  showGuides = false,
  readinessOf,
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
  stickerUrlFor?: (stickerId: string) => string | undefined;
  pickActive?: boolean;
  onTapPlaceBase?: (slot: BaseSlot) => void;
  showGuides?: boolean;
  /**
   * Print-readiness for one frame, keyed by `frameKey` (Phase 7). Computed ONCE per edit by the
   * quality engine and looked up here — never recalculated per frame, which is what keeps the
   * badges free during a drag. Absent ⇒ this canvas draws no readiness badges at all, so hosts
   * without a quality report (the admin cover designer) are unaffected.
   */
  readinessOf?: (key: string) => Readiness | undefined;
}) {
  const { page, pair } = useBuilderDimensions();
  const baseReadiness = (slot: BaseSlot) => readinessOf?.(frameKey({ kind: 'base', blockKey: block.key, blockIndex: index, slot }));
  const overlayReadiness = (id: string) => readinessOf?.(frameKey({ kind: 'overlay', blockKey: block.key, blockIndex: index, id }));
  const pageRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [picking, setPicking] = useState<
    { kind: 'base'; slot: BaseSlot } | { kind: 'replace'; overlayId: string } | { kind: 'overlay-add' } | null
  >(null);

  const isDouble = block.template === 'double-spread';
  const start = physicalStart(blocks, index);
  const cost = PAGE_COST[block.template];

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

      {/* The page — premium paper with fold, shadow, page numbers. Click empty area = deselect. */}
      <div
        ref={pageRef}
        onPointerDown={() => onSelect({ kind: 'none' })}
        className="album-page relative w-full select-none overflow-hidden rounded-[14px]"
        style={{ aspectRatio: pair, containerType: 'inline-size' }}
      >
        {/* Background layer */}
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
            onSelect={(mods) => {
              onSelect({ kind: 'base', slot: 'image' });
              onSelectTarget?.({ kind: 'base', blockKey: block.key, slot: 'image' }, mods);
            }}
            onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'image' })}
            multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'image' })}
            onPick={() => setPicking({ kind: 'base', slot: 'image' })}
            onDrop={(id) => {
              api.assignBaseSlot(block.key, 'image', id);
              drag?.end();
            }}
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
                onSelect={(mods) => {
                  onSelect({ kind: 'base', slot: 'left' });
                  onSelectTarget?.({ kind: 'base', blockKey: block.key, slot: 'left' }, mods);
                }}
                onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'left' })}
                multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'left' })}
                onPick={() => setPicking({ kind: 'base', slot: 'left' })}
                onDrop={(id) => {
                  api.assignBaseSlot(block.key, 'left', id);
                  drag?.end();
                }}
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
                onSelect={(mods) => {
                  onSelect({ kind: 'base', slot: 'right' });
                  onSelectTarget?.({ kind: 'base', blockKey: block.key, slot: 'right' }, mods);
                }}
                onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'base', blockKey: block.key, slot: 'right' })}
                multiSelected={isTargetSelected?.({ kind: 'base', blockKey: block.key, slot: 'right' })}
                onPick={() => setPicking({ kind: 'base', slot: 'right' })}
                onDrop={(id) => {
                  api.assignBaseSlot(block.key, 'right', id);
                  drag?.end();
                }}
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
              />
            </div>
          </>
        )}

        {/* Overlays (floating framed photos — or empty placeholder containers) */}
        {block.overlays.map((o, i) => {
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
              ariaLabel="Photo overlay"
              onSelect={(mods) => {
                onSelect({ kind: 'overlay', id: oid });
                onSelectTarget?.({ kind: 'overlay', blockKey: block.key, id: oid }, mods ?? { meta: false, shift: false });
              }}
              onContextMenu={(e) => onFrameContextMenu?.(e, { kind: 'overlay', blockKey: block.key, id: oid })}
              onChange={(r) => api.patchOverlays(block.key, block.overlays.map((ov) => (ov.id === oid ? { ...ov, ...r } : ov)))}
              onSnap={setSnap}
              /* Sibling overlays feed the edge + equal-spacing guides. */
              peers={block.overlays.filter((o) => o.id !== oid).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }))}
              className="overflow-hidden rounded-md border-2 border-white shadow-md"
              controls={
                <ElementControls
                  onForward={i < block.overlays.length - 1 ? () => api.reorderOverlay(block.key, oid, 1) : undefined}
                  onBackward={i > 0 ? () => api.reorderOverlay(block.key, oid, -1) : undefined}
                  onDelete={() => {
                    api.removeOverlay(block.key, oid);
                    onSelect({ kind: 'none' });
                  }}
                  extra={
                    <>
                      <CtlBtn label="Replace photo" onClick={() => setPicking({ kind: 'replace', overlayId: oid })}>
                        <Replace />
                      </CtlBtn>
                      {photo && o.photoId && (
                        <CtlBtn label="Edit photo" onClick={() => onEditPhoto(o.photoId!)}>
                          <SlidersHorizontal />
                        </CtlBtn>
                      )}
                      <CtlBtn
                        label="Duplicate overlay"
                        onClick={() => {
                          const ni = api.duplicateOverlay(block.key, oid);
                          if (ni !== undefined) onSelect({ kind: 'overlay', id: ni });
                        }}
                      >
                        <Copy />
                      </CtlBtn>
                    </>
                  }
                />
              }
            >
              <OverlayContent
                photo={photo}
                task={photo ? taskFor?.(photo.id) : undefined}
                readiness={overlayReadiness(oid)}
                onDropPhoto={(id) => api.replaceOverlay(block.key, oid, id)}
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
            ariaLabel="Text"
            onSelect={() => onSelect({ kind: 'text', id: t.id })}
            onChange={(r) => api.patchText(block.key, t.id, r)}
            onRotate={(deg) => api.patchText(block.key, t.id, { rotation: deg })}
            onSnap={setSnap}
            onDoubleClick={() => setEditingText(t.id)}
            controls={
              <ElementControls
                onForward={() => api.reorderText(block.key, t.id, 1)}
                onBackward={() => api.reorderText(block.key, t.id, -1)}
                onDelete={() => {
                  api.removeText(block.key, t.id);
                  onSelect({ kind: 'none' });
                }}
                extra={
                  <>
                    <CtlBtn label="Edit text" onClick={() => setEditingText(t.id)}>
                      <Pencil />
                    </CtlBtn>
                    <CtlBtn label="Duplicate" onClick={() => api.duplicateText(block.key, t.id)}>
                      <Copy />
                    </CtlBtn>
                  </>
                }
              />
            }
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
            ariaLabel="QR code"
            onSelect={() => onSelect({ kind: 'qr', id: q.id })}
            onChange={(r) => api.patchQr(block.key, q.id, { ...r, h: squareQrHeight(r.w, pair) })}
            onSnap={setSnap}
            controls={
              <ElementControls
                onForward={undefined}
                onBackward={undefined}
                onDelete={() => {
                  api.removeQr(block.key, q.id);
                  onSelect({ kind: 'none' });
                }}
              />
            }
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
            ariaLabel="Sticker"
            onSelect={() => onSelect({ kind: 'sticker', id: s.id })}
            onChange={(r) => api.patchSticker(block.key, s.id, r)}
            onRotate={(deg) => api.patchSticker(block.key, s.id, { rotation: deg })}
            onSnap={setSnap}
            controls={
              <ElementControls
                onForward={() => api.reorderSticker(block.key, s.id, 1)}
                onBackward={() => api.reorderSticker(block.key, s.id, -1)}
                onDelete={() => {
                  api.removeSticker(block.key, s.id);
                  onSelect({ kind: 'none' });
                }}
                extra={
                  <CtlBtn
                    label="Duplicate"
                    onClick={() => {
                      const ni = api.duplicateSticker(block.key, s.id);
                      if (ni) onSelect({ kind: 'sticker', id: ni });
                    }}
                  >
                    <Copy />
                  </CtlBtn>
                }
              />
            }
          >
            <StickerContent el={s} url={stickerUrlFor?.(s.stickerId)} />
          </Movable>
        ))}

        {/* Snap guides while dragging */}
        <SnapGuides lines={snap} />

        {/* Guides — margins + safe-zone + bleed (client-only; never printed). */}
        {showGuides && (
          <div className="pointer-events-none absolute inset-0 z-[8]">
            <div className="absolute inset-[1.5%] border border-dashed border-destructive/40" />
            <div className="absolute left-[4%] top-[6%] h-[88%] w-[42%] border border-dashed border-studio/45" />
            <div className="absolute right-[4%] top-[6%] h-[88%] w-[42%] border border-dashed border-studio/45" />
          </div>
        )}

        {/* Centre fold — bound spine groove with a faint running stitch. */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[6] -translate-x-1/2">
          <div className="album-binding h-full" />
          <div className="album-stitch absolute inset-y-0 left-1/2 -translate-x-1/2" />
        </div>

        {/* Page numbers */}
        <span className="pointer-events-none absolute bottom-2 left-3 z-[7] text-[10px] font-medium tabular-nums text-foreground/35">
          {start}
        </span>
        <span className="pointer-events-none absolute bottom-2 right-3 z-[7] text-[10px] font-medium tabular-nums text-foreground/35">
          {start + cost - 1}
        </span>
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
            if (picking.kind === 'base') api.assignBaseSlot(block.key, picking.slot, id);
            else if (picking.kind === 'replace') api.replaceOverlay(block.key, picking.overlayId, id);
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
function OverlayContent({
  photo,
  task,
  readiness,
  onDropPhoto,
}: {
  photo?: Photo;
  task?: UploadTask;
  readiness?: Readiness;
  onDropPhoto: (photoId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const uiState = photo ? photoUiState(photo, task) : 'ready';
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData('text/photo-id');
        if (id) onDropPhoto(id);
      }}
      className="relative h-full w-full"
    >
      {photo ? (
        <>
          <div className={`h-full w-full ${stateOpacityClass(uiState)}`}>
            <PhotoFrame url={resolvePhotoUrl(photo, 'full') ?? ''} edit={photo.edit} alt="overlay" />
          </div>
          <UploadBadge state={uiState} progress={task?.progress} since={photo?.processingSince ?? null} size="compact" />
          <ReadinessBadge readiness={readiness} size="compact" />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-studio/40 bg-studio-soft/60 text-center">
          <ImagePlus className="h-4 w-4 text-studio/70" />
          <span className="px-1 text-[10px] font-medium leading-tight text-studio/80">Empty overlay — drop a photo</span>
        </div>
      )}
      {/* Drop feedback (CHANGE 10): a filled overlay shows a clear "Replace" affordance so the user
          knows the drop will swap the existing photo; an empty one just glows as a valid target. */}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-studio/15 ring-2 ring-inset ring-studio-bright">
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
}: {
  photo?: Photo;
  task?: UploadTask;
  label: string;
  selected: boolean;
  /** Print readiness for this frame (Phase 7). Draws nothing unless it says something. */
  readiness?: Readiness;
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
  onSelect: (mods: { meta: boolean; shift: boolean }) => void;
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
        if (photo) onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        onContextMenu?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (tapToPlace) onTapPlace?.();
        else if (!photo) onPick();
        else onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
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
        e.dataTransfer.setData('text/photo-id', photo.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartFrame?.(photo.id);
      }}
      onDragEnd={() => onDragEndFrame?.()}
      onDragOver={(e) => {
        e.preventDefault();
        // `move` when the photo comes from another frame, `copy` from the tray — the cursor then
        // tells the truth about whether the source keeps its photo.
        e.dataTransfer.dropEffect = photo ? 'move' : 'copy';
        if (!over) {
          setOver(true);
          onDragEnterTarget?.();
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/photo-id');
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
            <UploadBadge state={uiState} progress={task?.progress} since={photo?.processingSince ?? null} size="compact" />
          </span>
          {/* Bottom-left, so it never collides with the upload pill (top-left) or the slot
              controls (top-right). Hidden mid-drag — a drop preview shouldn't be judged. */}
          {!incomingPreviewUrl && !isDragSource && <ReadinessBadge readiness={readiness} size="compact" />}
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
function PhotoPicker({
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
