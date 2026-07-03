'use client';

import { useState } from 'react';
import { Copy, Trash2, Plus, GripVertical } from 'lucide-react';
import PairContent from './_pair-frame';
import type { Photo } from './_uploader';
import type { Block } from '@/lib/builder/model';

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
  current,
  canAddMore,
  onJump,
  onReorder,
  onInsertAfter,
  onDuplicate,
  onDelete,
}: {
  blocks: Block[];
  photoMap: Map<string, Photo>;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  current: number;
  canAddMore: boolean;
  onJump: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onInsertAfter: (index: number) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const photoFor = (id: string | null | undefined) => {
    const p = id ? photoMap.get(id) : undefined;
    return p ? { url: p.url, edit: p.edit } : undefined;
  };

  if (blocks.length === 0) return null;

  return (
    <div className="ms-scroll flex items-end gap-2.5 overflow-x-auto px-1 py-1">
      {blocks.map((b, i) => (
        <div
          key={b.key}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragOver !== i) setDragOver(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i);
            setDragFrom(null);
            setDragOver(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragOver(null);
          }}
          className={`group/thumb relative flex-none ${dragFrom === i ? 'opacity-40' : ''}`}
        >
          <button
            type="button"
            onClick={() => onJump(i)}
            title={`Spread ${i + 1}`}
            aria-current={i === current ? 'true' : undefined}
            className={`relative block h-[58px] w-[116px] overflow-hidden rounded-lg bg-white ring-2 transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${
              i === current ? 'ring-studio shadow-card' : dragOver === i ? 'ring-studio-bright' : 'ring-border'
            }`}
            style={{ containerType: 'inline-size' }}
          >
            {b.background || b.photoIds.some(Boolean) || b.overlays.length || b.texts.length || b.qrs.length || b.stickers.length ? (
              <PairContent block={b} photoFor={photoFor} stickerUrlFor={stickerUrlFor} />
            ) : (
              <span className="grid h-full w-full place-items-center text-[10px] text-muted-foreground/60">Empty</span>
            )}
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10" />
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
