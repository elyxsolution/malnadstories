'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Trash2, Plus, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import PairContent from './_pair-frame';
import type { Photo } from '@/lib/builder/photo';
import type { PhotoUiState } from './_photo-state';
import { usePhotoFor } from './_use-photo-for';
import type { Block } from '@/lib/builder/model';
import { ReadinessDot } from './_readiness-badge';
import type { ReadinessLevel } from './_quality-model';

/**
 * Bottom timeline filmstrip — one true-to-life mini spread per block (rendered through the
 * same `PairContent`, so backgrounds, text and QR all show). Click to focus, drag to
 * reorder, and per-page controls to insert / duplicate / delete. Reordering never changes
 * which photo sits in which slot, so placed-once is preserved.
 */
export default function Navigator({
  blocks,
  photoMap,
  stickerUrlFor,
  photoStateFor,
  current,
  canAddMore,
  collapsed = false,
  onToggleCollapsed,
  dragActive = false,
  onDropPhotoOnPage,
  onJump,
  onReorder,
  onInsertAfter,
  onDuplicate,
  onDelete,
  spreadLevels,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Drives the shared status dot on thumbs — the micro form of the same badge. */
  photoStateFor?: (photoId: string) => PhotoUiState | undefined;
  /**
   * Worst print-readiness level found on each spread (Phase 7), by index. Renders as one 6px
   * dot per thumb — enough to tell someone WHICH page to look at while scrolling the strip,
   * and absent entirely for spreads that are fine. Optional: without it the strip is unchanged.
   */
  spreadLevels?: Map<number, ReadinessLevel>;
  current: number;
  canAddMore: boolean;
  /** Collapse the strip to a single line — useful on short screens. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** True while any drag is in progress — enables auto-scroll + the drop affordance. */
  dragActive?: boolean;
  /** A photo was dropped on a page thumb: place it on that spread (cross-page move). */
  onDropPhotoOnPage?: (blockKey: string, photoId: string) => void;
  onJump: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onInsertAfter: (index: number) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  /** A photo (not a page) is hovering this thumb — the cross-page drop affordance. */
  const [photoOver, setPhotoOver] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(0);

  const photoFor = usePhotoFor(photoMap, photoStateFor);

  /**
   * AUTO-SCROLL while dragging near either end of the strip. Without it, moving a photo to a page
   * that is off-screen is impossible — you would have to drop, scroll, and drag again. Runs on
   * `requestAnimationFrame` and is torn down the moment the drag leaves the hot zone.
   */
  useEffect(() => {
    if (!dragActive) {
      autoScroll.current = 0;
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = stripRef.current;
      if (el && autoScroll.current !== 0) el.scrollLeft += autoScroll.current * 14;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragActive]);

  const onStripDragOver = (e: React.DragEvent) => {
    const el = stripRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const left = e.clientX - box.left;
    const right = box.right - e.clientX;
    autoScroll.current = left < 64 ? -(1 - left / 64) : right < 64 ? 1 - right / 64 : 0;
  };

  if (blocks.length === 0) return null;

  if (collapsed) {
    // Collapsed: a single quiet line that still says where you are and lets you get back.
    return (
      <div className="flex items-center gap-2 px-1 py-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <ChevronUp className="h-3.5 w-3.5" /> Pages
        </button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          Spread {Math.max(1, current + 1)} of {blocks.length}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={stripRef}
      onDragOver={onStripDragOver}
      onDragLeave={() => {
        autoScroll.current = 0;
      }}
      className="ms-scroll flex items-end gap-2.5 overflow-x-auto px-1 py-1"
    >
      {/* Collapse control — sticky so it stays reachable however far the strip is scrolled. */}
      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded
          aria-label="Collapse page strip"
          title="Collapse pages"
          className="sticky left-0 z-10 mb-4 grid h-7 w-7 flex-none place-items-center rounded-lg border border-input bg-background/95 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
      {blocks.map((b, i) => (
        <div
          key={b.key}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => {
            e.preventDefault();
            // Two kinds of drag land here: a PAGE being reordered, or a PHOTO being moved to
            // this spread. They get different affordances because they mean different things.
            if (dragFrom !== null) {
              if (dragOver !== i) setDragOver(i);
            } else if (onDropPhotoOnPage) {
              e.dataTransfer.dropEffect = 'move';
              if (photoOver !== i) setPhotoOver(i);
            }
          }}
          onDragLeave={() => setPhotoOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) {
              onReorder(dragFrom, i);
            } else {
              const photoId = e.dataTransfer.getData('text/photo-id');
              if (photoId && onDropPhotoOnPage) onDropPhotoOnPage(b.key, photoId);
            }
            setDragFrom(null);
            setDragOver(null);
            setPhotoOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragOver(null);
            setPhotoOver(null);
          }}
          className={`group/thumb relative flex-none transition-transform duration-150 ease-glide ${
            dragFrom === i ? 'opacity-40' : ''
          } ${photoOver === i ? 'motion-safe:-translate-y-1' : ''}`}
        >
          <button
            type="button"
            onClick={() => onJump(i)}
            title={`Spread ${i + 1}`}
            aria-current={i === current ? 'true' : undefined}
            /* Larger thumbnails (was 58×116) — legible enough to recognise a spread at a glance. */
            className={`relative block h-[72px] w-[144px] overflow-hidden rounded-lg bg-white ring-2 transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${
              i === current
                ? 'ring-studio shadow-card'
                : photoOver === i
                  ? 'ring-studio-bright shadow-card'
                  : dragOver === i
                    ? 'ring-studio-bright'
                    : 'ring-border'
            }`}
            style={{ containerType: 'inline-size' }}
          >
            {b.background || b.photoIds.some(Boolean) || b.overlays.length || b.texts.length || b.qrs.length || b.stickers.length ? (
              <PairContent block={b} photoFor={photoFor} stickerUrlFor={stickerUrlFor} badge="micro" />
            ) : (
              <span className="grid h-full w-full place-items-center text-[10px] text-muted-foreground/60">Empty</span>
            )}
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10" />
            <ReadinessDot level={spreadLevels?.get(i)} />
          </button>

          {/* Drag handle */}
          <span className="pointer-events-none absolute left-1 top-1 grid h-4 w-4 place-items-center rounded bg-foreground/40 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100">
            <GripVertical className="h-3 w-3" />
          </span>

          {/* Hover controls */}
          <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100">
            <ThumbBtn label="Duplicate page" disabled={!canAddMore} onClick={() => onDuplicate(b.key)}>
              <Copy className="h-3 w-3" />
            </ThumbBtn>
            <ThumbBtn label="Delete page" destructive onClick={() => onDelete(b.key)}>
              <Trash2 className="h-3 w-3" />
            </ThumbBtn>
          </div>

          <span className="mt-1 block text-center text-[10px] font-medium tabular-nums text-muted-foreground">{i + 1}</span>

          {/* Insert-after seam */}
          <button
            type="button"
            disabled={!canAddMore}
            onClick={() => onInsertAfter(i)}
            aria-label={`Insert page after ${i + 1}`}
            title="Insert page here"
            className="absolute -right-2.5 top-[18px] z-10 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-all duration-150 hover:bg-studio hover:text-studio-foreground group-hover/thumb:opacity-100 disabled:pointer-events-none disabled:opacity-0"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ThumbBtn({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-5 w-5 place-items-center rounded bg-card/95 shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        destructive ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : 'text-foreground hover:bg-secondary'
      }`}
    >
      {children}
    </button>
  );
}
