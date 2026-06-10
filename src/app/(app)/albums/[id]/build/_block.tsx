'use client';

import { useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash2, ImagePlus, X, Layers, Replace, Crop } from 'lucide-react';
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
  onAddOverlay,
  onReplaceOverlay,
  onPatchOverlays,
  onRemove,
  onMove,
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
  onAddOverlay: (photoId: string) => void;
  onReplaceOverlay: (index: number, photoId: string) => void;
  onPatchOverlays: (overlays: Overlay[]) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
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
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{TEMPLATE_LABEL[block.template]}</span>
          <span className="ml-2 text-xs text-muted-foreground">{pageLabel}</span>
          {isDouble && <span className="ml-2 text-xs text-primary">· one image, spans both pages</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPicking({ kind: 'add' })}>
            <Layers /> Add overlay
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up">
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down">
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove pair" className="text-destructive">
            <Trash2 />
          </Button>
        </div>
      </div>

      {/* Open-pair canvas (3:2 = two 3:4 pages) with a centre gutter. */}
      <div ref={baseRef} className="group/slot relative aspect-[3/2] w-full overflow-hidden rounded-md border">
        {isDouble ? (
          <BaseSlotView
            photo={leftPhoto}
            label="Click or drop the image (spans both pages)"
            onPick={() => setPicking({ kind: 'base', slot: 'image' })}
            onDrop={(id) => onAssignBase('image', id)}
            onClear={() => onClearBase('image')}
            onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], 3 / 2, true) : undefined}
          />
        ) : (
          <>
            <div className="absolute left-0 top-0 h-full w-1/2">
              <BaseSlotView
                photo={leftPhoto}
                label="Left page"
                onPick={() => setPicking({ kind: 'base', slot: 'left' })}
                onDrop={(id) => onAssignBase('left', id)}
                onClear={() => onClearBase('left')}
                onCrop={leftPhoto ? () => onQuickCrop(block.photoIds[0], 3 / 4, false) : undefined}
              />
            </div>
            <div className="absolute left-1/2 top-0 h-full w-1/2">
              <BaseSlotView
                photo={rightPhoto}
                label="Right page"
                onPick={() => setPicking({ kind: 'base', slot: 'right' })}
                onDrop={(id) => onAssignBase('right', id)}
                onClear={() => onClearBase('right')}
                onCrop={rightPhoto ? () => onQuickCrop(block.photoIds[1], 3 / 4, false) : undefined}
              />
            </div>
          </>
        )}

        {/* Centre gutter (the bound edge). */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-[5] w-px -translate-x-1/2 bg-white/70 mix-blend-difference" />

        {/* Overlays */}
        {block.overlays.map((o, i) => {
          const photo = photoMap.get(o.photoId);
          return (
            <div
              key={i}
              className="group/ov absolute z-10 overflow-hidden rounded border-2 border-background shadow-md"
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
                className="absolute left-1 top-1 z-10 rounded bg-background/85 p-0.5 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background group-hover/ov:opacity-100"
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
                className="absolute right-1 top-1 z-10 rounded bg-background/85 p-0.5 opacity-0 shadow-sm transition-opacity hover:bg-background group-hover/ov:opacity-100"
              >
                <Replace className="h-3 w-3" />
              </button>
              <div
                onPointerDown={startOverlay(i, 'resize')}
                onPointerMove={moveOverlay}
                onPointerUp={endOverlay}
                className="absolute -bottom-1 -right-1 z-10 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-background bg-foreground/70"
              />
            </div>
          );
        })}
      </div>

      <input
        type="text"
        value={block.caption}
        onChange={(e) => onPatch({ caption: e.target.value })}
        placeholder="Caption (optional)"
        maxLength={200}
        className="mt-2 w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
  onPick,
  onDrop,
  onClear,
  onCrop,
}: {
  photo?: Photo;
  label: string;
  onPick: () => void;
  onDrop: (photoId: string) => void;
  onClear: () => void;
  onCrop?: () => void;
}) {
  return (
    <div
      onClick={onPick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/photo-id');
        if (id) onDrop(id);
      }}
      className="group/base absolute inset-0 cursor-pointer bg-muted"
    >
      {photo ? (
        <>
          <PhotoFrame url={photo.url} edit={photo.edit} alt={photo.filename} />
          <div className="absolute right-1 top-1 z-[6] flex gap-1 opacity-0 transition-opacity group-hover/base:opacity-100">
            {onCrop && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCrop();
                }}
                aria-label="Adjust crop"
                title="Adjust crop (pan/zoom)"
                className="rounded bg-background/85 p-1 shadow-sm hover:bg-background"
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
              className="rounded bg-background/85 p-1 text-destructive shadow-sm hover:bg-background"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground">
          <ImagePlus className="h-6 w-6" />
          <span className="mt-1 px-2 text-center text-xs">{label}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {options.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">All photos are already placed. Free one up or upload more.</p>
        ) : (
          <div className="mt-3 grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                className={`relative aspect-square overflow-hidden rounded-md border bg-muted transition-all hover:ring-2 hover:ring-ring ${
                  current?.id === p.id ? 'ring-2 ring-foreground' : ''
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
