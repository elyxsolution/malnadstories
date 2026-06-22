'use client';

import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, ImagePlus, X, Layers, Replace, Crop, SlidersHorizontal } from 'lucide-react';
import PhotoFrame from './_photo-frame';
import type { Photo } from './_uploader';
import { PAGE_COST, TEMPLATE_LABEL, physicalStart, type Block, type Overlay } from '@/lib/builder/model';
import { Button } from '@/components/ui/button';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export type BaseSlot = 'left' | 'right' | 'image';
type Picking = { kind: 'base'; slot: BaseSlot } | { kind: 'add' } | { kind: 'replace'; index: number } | null;

/**
 * One content PAIR (two physical pages) in the OPEN-BOOK view (aspect 3:2).
 *   single-pair    two independent base slots (left half + right half).
 *   double-spread  one image slot spanning the whole pair; the PDF splits it at centre.
 * Overlays float anywhere across the open pair (drag + resize), normalized to the box.
 * All per-photo editing (crop/zoom/rotate/flip/brightness/sharpen) is unchanged — it
 * lives on the photo via the editor and renders through the shared PhotoFrame.
 */
export default function BlockCard({
  block,
  index,
  blocks,
  photoMap,
  availablePhotos,
  isFirst,
  isLast,
  onPatch,
  onAssignBase,
  onClearBase,
  onQuickCrop,
  onEditPhoto,
  onAddOverlay,
  onReplaceOverlay,
  onPatchOverlays,
  onRemove,
  onMove,
  pickActive = false,
  onTapPlaceBase,
  showGuides = false,
}: {
  block: Block;
  index: number;
  blocks: Block[];
  photoMap: Map<string, Photo>;
  availablePhotos: Photo[];
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<Block>) => void;
  onAssignBase: (slot: BaseSlot, photoId: string) => void;
  onClearBase: (slot: BaseSlot) => void;
  onQuickCrop: (photoId: string, frameAspect: number, showGutter: boolean) => void;
  /** Open the FULL photo editor (crop/rotate/brightness/flip) for a placed photo. */
  onEditPhoto: (photoId: string) => void;
  onAddOverlay: (photoId: string) => void;
  onReplaceOverlay: (index: number, photoId: string) => void;
  onPatchOverlays: (overlays: Overlay[]) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  /** Tap-to-place: when a tray photo is "picked up", clicking an empty base slot places it. */
  pickActive?: boolean;
  onTapPlaceBase?: (slot: BaseSlot) => void;
  /** Show the margin / safe-zone guides overlay (client-only, presentation). */
  showGuides?: boolean;
}) {
  const [picking, setPicking] = useState<Picking>(null);
  const baseRef = useRef<HTMLDivElement>(null);

  const isDouble = block.template === 'double-spread';
  const start = physicalStart(blocks, index);
  const cost = PAGE_COST[block.template]; // always 2
  const pageLabel = `Pages ${start}–${start + cost - 1}`;

  const leftPhoto = block.photoIds[0] ? photoMap.get(block.photoIds[0]) : undefined;
  const rightPhoto = block.photoIds[1] ? photoMap.get(block.photoIds[1]) : undefined;

  // ── overlay drag / resize (normalized to the open-pair box) ──────────────────
  const drag = useRef<{ i: number; mode: 'move' | 'resize'; x: number; y: number; o: Overlay } | null>(null);
  const startOverlay = (i: number, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { i, mode, x: e.clientX, y: e.clientY, o: block.overlays[i] };
  };
  const moveOverlay = (e: React.PointerEvent) => {
    const base = baseRef.current;
    if (!drag.current || !base) return;
    const rect = base.getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / rect.width;
    const dy = (e.clientY - drag.current.y) / rect.height;
    const { i, mode, o } = drag.current;
    const next = [...block.overlays];
    if (mode === 'move') {
      next[i] = { ...o, x: clamp01(Math.min(o.x + dx, 1 - o.w)), y: clamp01(Math.min(o.y + dy, 1 - o.h)) };
    } else {
      next[i] = { ...o, w: Math.max(0.1, Math.min(o.w + dx, 1 - o.x)), h: Math.max(0.1, Math.min(o.h + dy, 1 - o.y)) };
    }
    onPatchOverlays(next);
  };
  const endOverlay = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
  };
  const removeOverlay = (i: number) => onPatchOverlays(block.overlays.filter((_, idx) => idx !== i));

  const pick = (id: string) => {
    if (!picking) return;
    if (picking.kind === 'base') onAssignBase(picking.slot, id);
    else if (picking.kind === 'add') onAddOverlay(id);
    else onReplaceOverlay(picking.index, id);
    setPicking(null);
  };
  const pickerCurrent =
    picking?.kind === 'base'
      ? picking.slot === 'right'
        ? rightPhoto
        : leftPhoto
      : picking?.kind === 'replace'
        ? photoMap.get(block.overlays[picking.index]?.photoId)
        : undefined;

  return (
    <div className="group/block">
      <div className="mb-3 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.08] text-[11px] font-semibold tabular-nums text-white/90 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)] ring-1 ring-white/15">
            {index + 1}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-[15px] font-semibold tracking-tight text-white/95">{TEMPLATE_LABEL[block.template]}</span>
            <span className="text-[11px] text-white/50">
              {pageLabel}
              {isDouble && ' · one image across both pages'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-70 transition-opacity duration-200 group-hover/block:opacity-100">
          <button
            type="button"
            onClick={() => setPicking({ kind: 'add' })}
            className="builder-glass inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/90 shadow-sm transition-colors duration-150 ease-glide hover:bg-white/10 hover:text-white"
          >
            <Layers className="h-3.5 w-3.5" /> Add overlay
          </button>
          <div className="builder-glass flex items-center gap-0.5 rounded-lg p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={isFirst}
              aria-label="Move up"
              className="grid h-7 w-7 place-items-center rounded-md text-white/80 transition-colors duration-150 ease-glide hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={isLast}
              aria-label="Move down"
              className="grid h-7 w-7 place-items-center rounded-md text-white/80 transition-colors duration-150 ease-glide hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-white/15" />
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove pair"
              className="grid h-7 w-7 place-items-center rounded-md text-red-300/90 transition-colors hover:bg-red-500/20 hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Open-pair canvas (3:2 = two 3:4 pages) rendered as a floating paper page. */}
      <div ref={baseRef} className="album-page group/slot relative aspect-[3/2] w-full overflow-hidden rounded-xl transition-transform duration-300 ease-premium group-hover/block:-translate-y-1">
        {isDouble ? (
          <BaseSlotView
            photo={leftPhoto}
            label="Click or drop the image (spans both pages)"
            pickActive={pickActive}
            onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('image') : undefined}
            onPick={() => setPicking({ kind: 'base', slot: 'image' })}
            onDrop={(id) => onAssignBase('image', id)}
            onClear={() => onClearBase('image')}
            onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], 3 / 2, true) : undefined}
            onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
          />
        ) : (
          <>
            <div className="absolute left-0 top-0 h-full w-1/2">
              <BaseSlotView
                photo={leftPhoto}
                label="Left page"
                pickActive={pickActive}
                onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('left') : undefined}
                onPick={() => setPicking({ kind: 'base', slot: 'left' })}
                onDrop={(id) => onAssignBase('left', id)}
                onClear={() => onClearBase('left')}
                onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], 3 / 4, false) : undefined}
                onEdit={leftPhoto ? () => onEditPhoto(block.photoIds[0]) : undefined}
              />
            </div>
            <div className="absolute left-1/2 top-0 h-full w-1/2">
              <BaseSlotView
                photo={rightPhoto}
                label="Right page"
                pickActive={pickActive}
                onTapPlace={onTapPlaceBase ? () => onTapPlaceBase('right') : undefined}
                onPick={() => setPicking({ kind: 'base', slot: 'right' })}
                onDrop={(id) => onAssignBase('right', id)}
                onClear={() => onClearBase('right')}
                onCrop={rightPhoto ? () => onQuickCrop(block.photoIds[1], 3 / 4, false) : undefined}
                onEdit={rightPhoto ? () => onEditPhoto(block.photoIds[1]) : undefined}
              />
            </div>
          </>
        )}

        {/* Margin / safe-zone guides (client-only overlay; never persisted/printed). */}
        {showGuides && (
          <div className="pointer-events-none absolute inset-0 z-[8]">
            <div className="absolute left-[3%] top-[5%] h-[90%] w-[44%] border border-dashed border-[#97402f]/55" />
            <div className="absolute right-[3%] top-[5%] h-[90%] w-[44%] border border-dashed border-[#97402f]/55" />
          </div>
        )}

        {/* Signature bound spine — a fold groove carrying a faint running stitch. */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] -translate-x-1/2">
          <div className="album-binding h-full" />
          <div className="album-stitch absolute inset-y-0 left-1/2 -translate-x-1/2" />
        </div>

        {/* Overlays */}
        {block.overlays.map((o, i) => {
          const photo = photoMap.get(o.photoId);
          return (
            <div
              key={i}
              className="group/ov absolute z-10 overflow-hidden rounded-md border-2 border-background shadow-md ring-1 ring-transparent transition-shadow duration-150 hover:shadow-elevated hover:ring-primary/60"
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
            >
              <div
                onPointerDown={startOverlay(i, 'move')}
                onPointerMove={moveOverlay}
                onPointerUp={endOverlay}
                className="absolute inset-0 cursor-move touch-none"
              >
                {photo ? <PhotoFrame url={photo.url} edit={photo.edit} alt="overlay" /> : <div className="h-full w-full bg-muted" />}
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeOverlay(i);
                }}
                aria-label="Delete overlay"
                className="absolute left-1 top-1 z-10 rounded-md bg-background/80 p-1 text-destructive opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition-opacity duration-150 hover:bg-background group-hover/ov:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setPicking({ kind: 'replace', index: i });
                }}
                aria-label="Replace overlay photo"
                className="absolute right-1 top-1 z-10 rounded-md bg-background/80 p-1 opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition-opacity duration-150 hover:bg-background group-hover/ov:opacity-100"
              >
                <Replace className="h-3 w-3" />
              </button>
              {photo && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditPhoto(o.photoId);
                  }}
                  aria-label="Edit overlay photo"
                  title="Edit photo (crop, rotate, brightness, flip)"
                  className="absolute right-1 top-8 z-10 rounded-md bg-background/80 p-1 opacity-0 shadow-sm ring-1 ring-border backdrop-blur-sm transition-opacity duration-150 hover:bg-background group-hover/ov:opacity-100"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                </button>
              )}
              <div
                onPointerDown={startOverlay(i, 'resize')}
                onPointerMove={moveOverlay}
                onPointerUp={endOverlay}
                className="absolute -bottom-1 -right-1 z-10 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-background bg-primary shadow-sm transition-transform duration-150 hover:scale-110"
              />
            </div>
          );
        })}
      </div>

      <input
        type="text"
        value={block.caption}
        onChange={(e) => onPatch({ caption: e.target.value })}
        placeholder="Add a caption…"
        maxLength={200}
        className="builder-glass mt-3 h-9 w-full rounded-lg px-3 text-sm text-white shadow-sm outline-none transition-all duration-150 placeholder:text-white/40 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/60"
      />

      {picking && (
        <PhotoPicker
          title={
            picking.kind === 'base'
              ? picking.slot === 'image'
                ? 'Choose the spread image'
                : `Choose the ${picking.slot} page photo`
              : picking.kind === 'add'
                ? 'Add an overlay photo'
                : 'Replace overlay photo'
          }
          current={pickerCurrent}
          available={availablePhotos}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** One base slot: click to pick, drop a tray photo, quick-crop, or clear. */
function BaseSlotView({
  photo,
  label,
  pickActive = false,
  onTapPlace,
  onPick,
  onDrop,
  onClear,
  onCrop,
  onEdit,
}: {
  photo?: Photo;
  label: string;
  pickActive?: boolean;
  onTapPlace?: () => void;
  onPick: () => void;
  onDrop: (photoId: string) => void;
  onClear: () => void;
  onCrop?: () => void;
  onEdit?: () => void;
}) {
  const [over, setOver] = useState(false);
  // Tap-to-place: with a photo "picked up", clicking an EMPTY slot drops it here;
  // otherwise the click opens the existing picker.
  const tapToPlace = pickActive && !photo && !!onTapPlace;
  return (
    <div
      onClick={tapToPlace ? onTapPlace : onPick}
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
        over ? 'ring-2 ring-inset ring-primary' : tapToPlace ? 'ring-2 ring-inset ring-gold/70' : ''
      }`}
    >
      {photo ? (
        <>
          <PhotoFrame url={photo.url} edit={photo.edit} alt={photo.filename} />
          {/* hover scrim so the controls always read on any photo */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[6] h-14 bg-gradient-to-b from-black/30 to-transparent opacity-0 transition-opacity duration-200 group-hover/base:opacity-100" />
          {over && <div className="pointer-events-none absolute inset-0 z-[6] bg-primary/20 ring-2 ring-inset ring-primary" />}
          <div className="absolute right-1.5 top-1.5 z-[7] flex gap-1 opacity-0 transition-all duration-200 group-hover/base:opacity-100">
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                aria-label="Edit photo"
                title="Edit photo (crop, rotate, brightness, flip)"
                className="rounded-lg bg-background/90 p-1.5 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
            {onCrop && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCrop();
                }}
                aria-label="Adjust crop"
                title="Adjust crop (pan/zoom)"
                className="rounded-lg bg-background/90 p-1.5 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Crop className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label="Remove photo"
              className="rounded-lg bg-background/90 p-1.5 text-destructive shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      ) : (
        <div
          className={`flex h-full w-full flex-col items-center justify-center gap-2.5 px-3 text-center transition-colors duration-200 ${
            over ? 'bg-accent/60' : 'bg-gradient-to-b from-secondary/60 to-muted/40'
          }`}
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed transition-all duration-200 ${
              over
                ? 'scale-110 border-primary bg-primary/10 text-primary'
                : 'border-muted-foreground/30 text-muted-foreground/70 group-hover/base:-translate-y-0.5 group-hover/base:border-primary/40 group-hover/base:bg-primary/5 group-hover/base:text-primary'
            }`}
          >
            <ImagePlus className="h-5 w-5" />
          </span>
          <span
            className={`text-xs font-medium tracking-tight transition-colors duration-200 ${
              over ? 'text-primary' : 'text-muted-foreground group-hover/base:text-foreground'
            }`}
          >
            {over ? 'Drop to place' : tapToPlace ? 'Tap to place here' : label}
          </span>
        </div>
      )}
    </div>
  );
}

function PhotoPicker({
  title,
  current,
  available,
  onPick,
  onClose,
}: {
  title: string;
  current?: Photo;
  available: Photo[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const options = current && !available.some((p) => p.id === current.id) ? [current, ...available] : available;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-rise w-full max-w-lg rounded-2xl border bg-background p-4 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {options.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            All photos are already placed. Free one up or upload more.
          </p>
        ) : (
          <div className="mt-3 grid max-h-[60vh] grid-cols-3 gap-2.5 overflow-y-auto p-0.5 sm:grid-cols-4">
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                className={`relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-primary/50 ${
                  current?.id === p.id ? 'ring-2 ring-primary' : ''
                }`}
                title={p.filename}
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
