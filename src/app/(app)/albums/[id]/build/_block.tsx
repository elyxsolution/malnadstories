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
import type { Photo } from './_uploader';
import { backgroundStyle, squareQrHeight, PAIR_ASPECT } from '@/lib/builder/elements';
import { PAGE_COST, physicalStart, type Block } from '@/lib/builder/model';
import type { BuilderApi, BaseSlot, Selection } from './_use-builder';

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
  availablePhotos,
  selection,
  onSelect,
  onEditPhoto,
  onQuickCrop,
  stickerUrlFor,
  pickActive = false,
  onTapPlaceBase,
  showGuides = false,
}: {
  api: BuilderApi;
  block: Block;
  index: number;
  blocks: Block[];
  photoMap: Map<string, Photo>;
  availablePhotos: Photo[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onEditPhoto: (photoId: string) => void;
  onQuickCrop: (photoId: string, frameAspect: number, showGutter: boolean) => void;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  pickActive?: boolean;
  onTapPlaceBase?: (slot: BaseSlot) => void;
  showGuides?: boolean;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [picking, setPicking] = useState<
    { kind: 'base'; slot: BaseSlot } | { kind: 'replace'; index: number } | { kind: 'overlay-add' } | null
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
        className="album-page relative aspect-[3/2] w-full select-none overflow-hidden rounded-[14px]"
        style={{ containerType: 'inline-size' }}
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
            label="Click or drop the image (spans both pages)"
            selected={sel({ kind: 'base', slot: 'image' })}
            pickActive={pickActive}
            onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('image') : undefined}
            onSelect={() => onSelect({ kind: 'base', slot: 'image' })}
            onPick={() => setPicking({ kind: 'base', slot: 'image' })}
            onDrop={(id) => api.assignBaseSlot(block.key, 'image', id)}
            onClear={() => api.clearBaseSlot(block.key, 'image')}
            onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], PAIR_ASPECT, true) : undefined}
            onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
          />
        ) : (
          <>
            <div className="absolute left-0 top-0 h-full w-1/2">
              <BaseSlotView
                photo={leftPhoto}
                label="Left page"
                selected={sel({ kind: 'base', slot: 'left' })}
                pickActive={pickActive}
                onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('left') : undefined}
                onSelect={() => onSelect({ kind: 'base', slot: 'left' })}
                onPick={() => setPicking({ kind: 'base', slot: 'left' })}
                onDrop={(id) => api.assignBaseSlot(block.key, 'left', id)}
                onClear={() => api.clearBaseSlot(block.key, 'left')}
                onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], 3 / 4, false) : undefined}
                onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
              />
            </div>
            <div className="absolute left-1/2 top-0 h-full w-1/2">
              <BaseSlotView
                photo={rightPhoto}
                label="Right page"
                selected={sel({ kind: 'base', slot: 'right' })}
                pickActive={pickActive}
                onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('right') : undefined}
                onSelect={() => onSelect({ kind: 'base', slot: 'right' })}
                onPick={() => setPicking({ kind: 'base', slot: 'right' })}
                onDrop={(id) => api.assignBaseSlot(block.key, 'right', id)}
                onClear={() => api.clearBaseSlot(block.key, 'right')}
                onCrop={rightPhoto ? () => onQuickCrop(block.photoIds[1], 3 / 4, false) : undefined}
                onEdit={rightPhoto ? () => onEditPhoto(block.photoIds[1]) : undefined}
              />
            </div>
          </>
        )}

        {/* Overlays (floating framed photos) */}
        {block.overlays.map((o, i) => {
          const photo = photoMap.get(o.photoId);
          return (
            <Movable
              key={`ov-${i}`}
              rect={o}
              selected={sel({ kind: 'overlay', index: i })}
              containerRef={pageRef}
              ariaLabel="Photo overlay"
              onSelect={() => onSelect({ kind: 'overlay', index: i })}
              onChange={(r) => api.patchOverlays(block.key, block.overlays.map((ov, idx) => (idx === i ? { ...ov, ...r } : ov)))}
              onSnap={setSnap}
              className="overflow-hidden rounded-md border-2 border-white shadow-md"
              controls={
                <ElementControls
                  onForward={i < block.overlays.length - 1 ? () => api.reorderOverlay(block.key, i, 1) : undefined}
                  onBackward={i > 0 ? () => api.reorderOverlay(block.key, i, -1) : undefined}
                  onDelete={() => {
                    api.removeOverlay(block.key, i);
                    onSelect({ kind: 'none' });
                  }}
                  extra={
                    <>
                      <CtlBtn label="Replace photo" onClick={() => setPicking({ kind: 'replace', index: i })}>
                        <Replace />
                      </CtlBtn>
                      {photo && (
                        <CtlBtn label="Edit photo" onClick={() => onEditPhoto(o.photoId)}>
                          <SlidersHorizontal />
                        </CtlBtn>
                      )}
                      <CtlBtn
                        label="Duplicate overlay"
                        onClick={() => {
                          const ni = api.duplicateOverlay(block.key, i);
                          if (ni !== undefined) onSelect({ kind: 'overlay', index: ni });
                        }}
                      >
                        <Copy />
                      </CtlBtn>
                    </>
                  }
                />
              }
            >
              {photo ? <PhotoFrame url={photo.url} edit={photo.edit} alt="overlay" /> : <div className="h-full w-full bg-muted" />}
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
            squareRatio={PAIR_ASPECT}
            minW={0.06}
            selected={sel({ kind: 'qr', id: q.id })}
            containerRef={pageRef}
            ariaLabel="QR code"
            onSelect={() => onSelect({ kind: 'qr', id: q.id })}
            onChange={(r) => api.patchQr(block.key, q.id, { ...r, h: squareQrHeight(r.w) })}
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
            else if (picking.kind === 'replace') api.replaceOverlay(block.key, picking.index, id);
            else {
              const newIndex = block.overlays.length;
              api.addOverlay(block.key, id);
              onSelect({ kind: 'overlay', index: newIndex });
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

// ── Base slot ─────────────────────────────────────────────────────────────────────
function BaseSlotView({
  photo,
  label,
  selected,
  pickActive = false,
  onTapPlace,
  onSelect,
  onPick,
  onDrop,
  onClear,
  onCrop,
  onEdit,
}: {
  photo?: Photo;
  label: string;
  selected: boolean;
  pickActive?: boolean;
  onTapPlace?: () => void;
  onSelect: () => void;
  onPick: () => void;
  onDrop: (photoId: string) => void;
  onClear: () => void;
  onCrop?: () => void;
  onEdit?: () => void;
}) {
  const [over, setOver] = useState(false);
  const tapToPlace = pickActive && !photo && !!onTapPlace;

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        if (photo) onSelect();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (tapToPlace) onTapPlace?.();
        else if (!photo) onPick();
        else onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (photo && onEdit) onEdit();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
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
      } ${selected ? 'ring-2 ring-inset ring-studio-bright' : ''}`}
    >
      {photo ? (
        <>
          <PhotoFrame url={photo.url} edit={photo.edit} alt={photo.filename} />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[6] h-14 bg-gradient-to-b from-black/25 to-transparent opacity-0 transition-opacity duration-200 group-hover/base:opacity-100" />
          {over && <div className="pointer-events-none absolute inset-0 z-[6] bg-studio/15 ring-2 ring-inset ring-studio-bright" />}
          <div className="absolute right-1.5 top-1.5 z-[7] flex gap-1 opacity-0 transition-all duration-200 group-hover/base:opacity-100">
            {onEdit && (
              <SlotBtn label="Edit photo" onClick={onEdit}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </SlotBtn>
            )}
            {onCrop && (
              <SlotBtn label="Adjust crop" onClick={onCrop}>
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
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-lg bg-background/90 p-1.5 shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors ${
        destructive ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-foreground hover:bg-studio hover:text-studio-foreground'
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
                <PhotoFrame url={p.url} edit={p.edit} alt={p.filename} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
