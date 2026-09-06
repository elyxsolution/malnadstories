'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Trash2, Plus, GripVertical, ChevronUp, ChevronDown, Square, BookOpen, LayoutGrid } from 'lucide-react';
import PairContent from './_pair-frame';
import type { Photo } from '@/lib/builder/photo';
import type { PhotoUiState } from './_photo-state';
import { usePhotoFor } from './_use-photo-for';
import type { Block } from '@/lib/builder/model';
import { acceptPhotoDrag, leftDropTarget, readPhotoDrag } from '@/lib/builder/photo-dnd';
import { ReadinessDot } from './_readiness-badge';
import type { ReadinessLevel } from './_quality-model';

/**
 * Bottom timeline filmstrip — one true-to-life mini spread per block (rendered through the
 * same `PairContent`, so backgrounds, text and QR all show). Click to focus, drag to
 * reorder, and per-page controls to insert / duplicate / delete. Reordering never changes
 * which photo sits in which slot, so placed-once is preserved.
 *
 * PASS 3 makes the strip PAGE MANAGEMENT, not just navigation. An empty album used to render
 * no strip at all — a dead end where the only way forward was a floating button elsewhere. Now
 * the strip always exists: an empty album shows a dedicated "Add first spread" tile right after
 * the cover, and a populated one ENDS with a persistent "Add spread" tile whose menu carries the
 * page operations (add single/double, duplicate, remove, choose a layout). Every item dispatches
 * the SAME callbacks the old floating button and per-thumb controls used — the strip is a new
 * trigger surface, not a new implementation.
 *
 * ONE HORIZONTAL COLLECTION: cover 0 → spread 1 → … → spread N → Add spread.
 *
 * The cover used to be rendered by the builder OUTSIDE this scroller, at its own smaller size and
 * captioned rather than numbered, and "Add spread" was pinned at the HEAD of the run — so the
 * sequence read cover · add · 1 · 2 · 3 and the add control never moved however many spreads
 * existed. Both are now ordinary items of this one flex row at the one thumbnail geometry, in
 * book order, which is what makes "the control that creates the next spread" sit where the next
 * spread will actually appear.
 *
 * The cover is still NOT a `Block`: it arrives as an already-rendered node plus its focus
 * callback, so it is never draggable, reorderable, duplicable or deletable, and `blocks` still
 * indexes the spreads exactly as it did — spread `i` is still numbered `i + 1`. The cover's
 * number is 0 because that is the page it is.
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
  onAddSpread,
  onOpenLayouts,
  currentKey,
  spreadLevels,
  coverThumb,
  coverActive = false,
  onFocusCover,
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
  /** Append a spread — the Add tile's primary action (same path as the old floating button). */
  onAddSpread: (template: 'single-pair' | 'double-spread') => void;
  /** Open the Layouts rail from the Add tile's menu. */
  onOpenLayouts?: () => void;
  /** The focused spread's key, so the Add menu can duplicate/remove the current page. */
  currentKey?: string | null;
  /**
   * PAGE 0. The cover's visual, already rendered by the builder (which owns the cover config, the
   * resolved images and the sticker resolver) and simply HOSTED here so it flows with the
   * spreads. Omitted → the strip renders exactly as it did before, spreads only.
   */
  coverThumb?: React.ReactNode;
  /** The cover is the focused surface. Mirrors a spread's `aria-current` + ring treatment. */
  coverActive?: boolean;
  /** Focus the cover — the builder's existing `focusCover`, unchanged. */
  onFocusCover?: () => void;
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
          {blocks.length === 0 ? 'No pages yet' : `Spread ${Math.max(1, current + 1)} of ${blocks.length}`}
        </span>
      </div>
    );
  }

  // EMPTY ALBUM — the strip's whole content is the invitation to start. Same tile geometry as a
  // page thumb, so adding the first spread happens exactly where that spread will then live.
  if (blocks.length === 0) {
    return (
      <div className="flex items-end gap-2.5 px-1 py-1">
        {coverThumb && (
          <CoverTile active={coverActive} onFocus={onFocusCover}>
            {coverThumb}
          </CoverTile>
        )}
        <div className="flex-none">
          <button
            type="button"
            disabled={!canAddMore}
            onClick={() => onAddSpread('single-pair')}
            className="group/first flex h-[72px] w-[144px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-card/60 text-muted-foreground transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright hover:text-studio hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary transition-colors group-hover/first:bg-studio-soft">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10.5px] font-medium">Add first spread</span>
          </button>
          <span className="mt-1 block text-center text-[10px] font-medium text-transparent" aria-hidden>
            ·
          </span>
        </div>
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

      {/* PAGE 0 — the cover, at the spread geometry, opening the run it belongs to. */}
      {coverThumb && (
        <CoverTile active={coverActive} onFocus={onFocusCover}>
          {coverThumb}
        </CoverTile>
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
              // The same declared effect every other photo target uses — see `photo-dnd`.
              acceptPhotoDrag(e);
              if (photoOver !== i) setPhotoOver(i);
            }
          }}
          onDragLeave={(e) => {
            if (leftDropTarget(e)) setPhotoOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) {
              onReorder(dragFrom, i);
            } else {
              const photoId = readPhotoDrag(e);
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
            className={`relative block h-[72px] w-[144px] overflow-hidden bg-white ring-2 transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${
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
            {/* An overlay with no photo in it draws nothing, so counting containers here would
                label a brand-new page (which now starts with one empty frame) as designed and
                show a blank white thumbnail instead of saying "Empty". Count what will draw. */}
            {b.background ||
            b.photoIds.some(Boolean) ||
            b.overlays.some((o) => o.photoId) ||
            b.texts.length ||
            b.qrs.length ||
            b.stickers.length ? (
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

          {/*
            INSERT-AFTER SEAM — and why it sits at 38px rather than 18px.

            It straddles the right edge (`-right-2.5`, so half of it hangs in the 10px gutter
            between two thumbs, which is the seam it inserts into). At `top-[18px]` its box was
            y 8-28 and x w-10 to w+10, while the Delete control above is y 4-24 and x w-24 to
            w-4 — a real 6x16px overlap, so the two round targets touched and the outer one
            could swallow a click meant for the other.

            `top-[38px]` (still centred by `-translate-y-1/2`) puts it at y 28-48: four clear
            pixels below Delete, still comfortably inside the 72px thumb, and still on the seam
            it belongs to. ONLY this control moved — Duplicate and Delete are untouched, and so
            are the icons, the hit area, the hover reveal and `onInsertAfter`.

            The geometry is fixed (144x72 thumbs, 20px controls) at every viewport, so the two
            cannot collide again at some other width.
          */}
          <button
            type="button"
            disabled={!canAddMore}
            onClick={() => onInsertAfter(i)}
            aria-label={`Insert page after ${i + 1}`}
            title="Insert page here"
            className="absolute -right-2.5 top-[38px] z-10 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-all duration-150 hover:bg-studio hover:text-studio-foreground group-hover/thumb:opacity-100 disabled:pointer-events-none disabled:opacity-0"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      ))}

      {/*
        ADD SPREAD, LAST — and it MOVES. It is the final item of the same flex run, so adding a
        spread pushes it right by exactly one thumbnail and it is always immediately after the
        last spread rather than at a fixed offset. Nothing about the tile itself changed: same
        geometry, same menu, same callbacks, and the insert-after affordance on every thumb still
        covers adding in the middle.
      */}
      <AddSpreadTile
        canAddMore={canAddMore}
        currentKey={currentKey ?? null}
        onAddSpread={onAddSpread}
        onOpenLayouts={onOpenLayouts}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * THE COVER, AS PAGE 0 — the same 144x72 card, the same ring treatment and the same number
 * caption a spread thumb carries, so the run reads as one sequence rather than a special item
 * followed by a list.
 *
 * It takes the spread chrome and nothing else: no drag handle, no duplicate/delete, no
 * insert-after seam, because none of those operations exist for a cover. The visual itself is
 * supplied by the builder; this component only places and decorates it.
 */
function CoverTile({
  active,
  onFocus,
  children,
}: {
  active: boolean;
  onFocus?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-none">
      <button
        type="button"
        onClick={onFocus}
        aria-current={active ? 'true' : undefined}
        title="Cover — back · spine · front"
        className={`group relative block h-[72px] w-[144px] overflow-hidden bg-white ring-2 transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${
          active ? 'ring-studio shadow-card' : 'ring-border'
        }`}
      >
        <div className="absolute inset-0">{children}</div>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-1 pb-0.5 pt-2 text-center text-[8px] font-semibold uppercase tracking-wide text-white">
          Cover
        </span>
      </button>
      {/* The SAME numbering style the spreads use — this is page 0. */}
      <span className="mt-1 block text-center text-[10px] font-medium tabular-nums text-muted-foreground">0</span>
    </div>
  );
}

/**
 * The strip's Add tile: it opens the page menu, which carries the full set of page operations
 * (add single, add double-page, choose a layout, duplicate, remove). It is the LAST item in the
 * scroller, immediately after the final spread, and it FLOWS with the run — adding a spread moves
 * it one thumbnail to the right. It used to be `sticky left-[38px]`, pinned between the cover and
 * page 1; a pinned control cannot follow the last spread, so the stickiness is gone.
 *
 * The menu is `position: fixed` and measured from the trigger because the strip is an
 * `overflow-x-auto` scroller — an absolute menu would be clipped by the very container it needs
 * to escape.
 */
function AddSpreadTile({
  canAddMore,
  currentKey,
  onAddSpread,
  onOpenLayouts,
  onDuplicate,
  onDelete,
}: {
  canAddMore: boolean;
  currentKey: string | null;
  onAddSpread: (template: 'single-pair' | 'double-spread') => void;
  onOpenLayouts?: () => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  // Measure on open; dismiss on outside pointer-down or Escape (returning focus to the tile).
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 216)), bottom: window.innerHeight - rect.top + 8 });
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="z-[5] flex-none bg-card">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add or manage spreads"
        aria-haspopup="menu"
        aria-expanded={open}
        title={canAddMore ? 'Add spread' : 'Manage spreads'}
        className={`flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright hover:text-studio hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
          open ? 'border-studio-bright bg-studio-soft/60 text-studio' : 'border-border bg-card/60'
        }`}
      >
        <Plus className="h-4 w-4" />
        <span className="text-[10px] font-medium leading-tight">Add spread</span>
      </button>
      <span className="mt-1 block text-center text-[10px] font-medium text-transparent" aria-hidden>
        ·
      </span>

      {open && pos && (
        <div
          role="menu"
          aria-label="Page menu"
          style={{ left: pos.left, bottom: pos.bottom }}
          className="motion-safe:animate-scale-in fixed z-[70] w-52 origin-bottom-left overflow-hidden rounded-xl border border-border bg-card p-1 shadow-elevated"
        >
          <AddItem icon={<Square />} label="Add spread" disabled={!canAddMore} onClick={() => { onAddSpread('single-pair'); setOpen(false); }} />
          <AddItem icon={<BookOpen />} label="Add double-page spread" disabled={!canAddMore} onClick={() => { onAddSpread('double-spread'); setOpen(false); }} />
          {onOpenLayouts && (
            <AddItem icon={<LayoutGrid />} label="Choose a layout…" onClick={() => { onOpenLayouts(); setOpen(false); }} />
          )}
          <div className="mx-2 my-1 h-px bg-border/70" aria-hidden />
          <AddItem
            icon={<Copy />}
            label="Duplicate this spread"
            disabled={!canAddMore || !currentKey}
            onClick={() => {
              if (currentKey) onDuplicate(currentKey);
              setOpen(false);
            }}
          />
          <AddItem
            icon={<Trash2 />}
            label="Remove this spread"
            destructive
            disabled={!currentKey}
            onClick={() => {
              if (currentKey) onDelete(currentKey);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** One row of the page menu — the same look the old floating add-menu used. */
function AddItem({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 ${
        destructive ? 'text-destructive hover:bg-destructive/10 [&_svg]:text-destructive' : 'text-foreground hover:bg-secondary [&_svg]:text-studio'
      }`}
    >
      {icon}
      {label}
    </button>
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
