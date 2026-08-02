'use client';

import { useState } from 'react';
import { Pencil, Trash2, Check, AlertTriangle, Image as ImageIcon, RotateCw, X, Star } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import { acceptPhotoDrag, readPhotoDrag, startPhotoDrag } from '@/lib/builder/photo-dnd';
import { isTempPhotoId, type UploadTask } from '@/lib/uploads';

import PhotoFrame from './_photo-frame';
import type { Photo } from '@/lib/builder/photo';
import { isPlaceable, photoUiState } from './_photo-state';
import UploadBadge, { stateOpacityClass } from './_upload-badge';
import { useVirtualGrid } from './_use-virtual-grid';
import { LABEL_META, type PhotoLabel } from './_photo-labels';

/** Below this many photos the grid renders in full — windowing a short list is pure overhead. */
const VIRTUALIZE_ABOVE = 60;

/**
 * The album's photo tray — now ONE list.
 *
 * Phase 2 drew real photos and in-flight upload tasks as two separate sets of tiles. Phase 3
 * collapses that: an optimistic photo IS a photo (with a `tmp_` id), so the tray renders
 * `photos` and nothing else, asking `photoUiState` how to dress each tile. There is no
 * second collection to drift, and a file keeps the exact same tile — same key, same pixels —
 * from the moment it is picked to the moment it is print-ready.
 *
 * PLACEMENT is now driven by `isPlaceable`, not by `status === 'ready'`: any photo with
 * something to draw can be dragged onto a page while it uploads. Editing still requires the
 * processed master (see `_photo-state`), and says so.
 */
export default function Tray({
  photos,
  taskFor,
  placedIds,
  pickedId = null,
  onPick,
  onEdit,
  onDeleted,
  onRetryUpload,
  onCancelUpload,
  onImageError,
  filtered = false,
  isSelected,
  onSelect,
  onContextMenu,
  isFavourite,
  onToggleFavourite,
  labelOf,
  onDragStartPhoto,
  onDragEndPhoto,
  onDropToTray,
  dragActive = false,
  onEmptyPointerDown,
  marqueeOverlay,
  onGrid,
}: {
  /** A thumbnail failed to load — usually an expired signed URL. Triggers a targeted refresh. */
  onImageError?: (photoId: string) => void;
  /** Multi-selection (Phase 6). Absent ⇒ the tray behaves exactly as it did before. */
  isSelected?: (photoId: string) => boolean;
  /** Click with modifiers — the tray never decides what a modifier MEANS; the store does. */
  onSelect?: (photoId: string, mods: { meta: boolean; shift: boolean }, orderedIds: string[]) => void;
  onContextMenu?: (e: React.MouseEvent, photoId: string) => void;
  isFavourite?: (photoId: string) => boolean;
  onToggleFavourite?: (photoId: string) => void;
  /**
   * The photographer's triage mark on this photo (Phase 7), or null. Drawn as a single coloured
   * hairline along the tile's bottom edge — legible while scanning a wall of thumbnails, and
   * gone entirely for unmarked photos, so an untouched tray looks exactly as it did before.
   */
  labelOf?: (photoId: string) => PhotoLabel | null;
  /** Publishes a tray drag to the shared drag store, so frames can preview the replacement. */
  onDragStartPhoto?: (photoId: string) => void;
  onDragEndPhoto?: () => void;
  /**
   * A photo was dropped back onto the tray — the "take it off the page" gesture. The tray never
   * decides what that means; the host runs the `removeFromPage` command.
   */
  onDropToTray?: (photoId: string) => void;
  /** True while a drag is in progress, so the tray can show its drop affordance. */
  dragActive?: boolean;
  /** Marquee support: the host supplies the rubber band + a pointer-down handler for empty space. */
  onEmptyPointerDown?: (e: React.PointerEvent) => void;
  marqueeOverlay?: React.ReactNode;
  /**
   * Reports the grid element and its measured geometry, so a marquee can hit-test GEOMETRICALLY
   * (including rows virtualization hasn't mounted) instead of walking the DOM.
   */
  onGrid?: (el: HTMLDivElement | null, geom: { columns: number; rowStride: number; gap: number; count: number }) => void;
  photos: Photo[];
  /** True when a search/filter is narrowing the list — changes what "empty" means. */
  filtered?: boolean;
  /** The upload task backing an optimistic photo, if it still has one. */
  taskFor?: (photoId: string) => UploadTask | undefined;
  placedIds: Set<string>;
  /** Tap-to-place: the photo currently "picked up" from the tray (ring), or null. */
  pickedId?: string | null;
  onPick?: (id: string) => void;
  onEdit: (photo: Photo) => void;
  onDeleted: (id: string) => void;
  onRetryUpload?: (taskId: string) => void;
  onCancelUpload?: (taskId: string) => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);

  /**
   * Only the rows near the viewport are mounted. Measured before this change: 2,000 photos
   * produced ~24,000 DOM nodes, 2,000 `ResizeObserver`s and 2,000 images to decode. Windowed,
   * the tray mounts roughly the same handful of tiles whether the album holds 50 or 2,000.
   * Below a threshold it stays fully rendered — windowing a short list costs more than it saves.
   */
  const virtual = useVirtualGrid(photos.length, photos.length > VIRTUALIZE_ABOVE);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this photo? It will be removed from any page it’s on.')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Delete failed');
      }
      onDeleted(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete photo');
    } finally {
      setDeleting(null);
    }
  };

  if (photos.length === 0) {
    // Three distinct empty states, because they mean three different things to the person
    // looking at them: nothing yet, nothing MATCHING (a filter is on), or an album whose photos
    // are all still in flight. A single generic message would be wrong in two of the three.
    if (filtered) {
      return (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
          <p className="text-sm font-medium tracking-tight">Nothing matches</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Try a different search, or clear the filter.</p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-gradient-to-b from-secondary/30 to-transparent px-4 py-10 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-background text-muted-foreground/70 shadow-xs ring-1 ring-border">
          <ImageIcon className="h-5 w-5" />
        </div>
        <p className="mt-3 text-base font-semibold tracking-tight">Your photos live here</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Add photos above — you can start placing them onto pages straight away, while they upload.
        </p>
      </div>
    );
  }

  // Visual order for shift-range selection — the FULL list, not the rendered window, so a range
  // spans rows that virtualization hasn't mounted.
  const orderedIds = photos.map((p) => p.id);

  // NOTE: queue positions ("Queued · 47") used to be computed here, which meant walking the
  // ENTIRE photo list on every tray render — including every render caused by scrolling a
  // virtualized grid — to tell someone their place in a line that was moving fine on its own.
  // The badge no longer distinguishes queued from uploading (see `badgeState`), so the walk is
  // gone with it.

  const windowed = photos.slice(virtual.startIndex, virtual.endIndex);

  return (
    <div
      ref={(el) => {
        // One element, two consumers: the virtualizer measures it, and the host needs it (plus
        // the measured geometry) to hit-test a marquee without touching the DOM.
        (virtual.containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        onGrid?.(el, { columns: virtual.columns, rowStride: virtual.rowStride, gap: virtual.gap, count: photos.length });
      }}
      /**
       * The tray is itself a DROP TARGET: dropping a photo here takes it off its page — the exact
       * reverse of dragging one on. The affordance appears only mid-drag, so the tray is
       * otherwise completely quiet.
       */
      onDragOver={(e) => {
        if (!onDropToTray) return;
        acceptPhotoDrag(e);
      }}
      onDrop={(e) => {
        if (!onDropToTray) return;
        e.preventDefault();
        const id = readPhotoDrag(e);
        if (id) onDropToTray(id);
      }}
      onPointerDown={(e) => {
        // A marquee begins only on EMPTY space — a pointer-down on a tile still selects it.
        if (e.target === e.currentTarget) onEmptyPointerDown?.(e);
      }}
      className={`relative grid grid-cols-3 gap-2 rounded-xl transition-[outline-color] duration-200 sm:grid-cols-4 ${
        dragActive && onDropToTray ? 'outline-dashed outline-2 outline-offset-4 outline-studio-bright/40' : 'outline-transparent'
      }`}
    >
      {marqueeOverlay}
      {/* Spacers stand in for the un-rendered rows so the scrollbar is unchanged. */}
      {virtual.padTop > 0 && <div aria-hidden style={{ gridColumn: '1 / -1', height: virtual.padTop }} />}
      {windowed.map((photo, w) => {
        const i = virtual.startIndex + w;
        const task = taskFor?.(photo.id);
        const state = photoUiState(photo, task);
        const optimistic = isTempPhotoId(photo.id);
        const placeable = isPlaceable(photo, state);
        const placed = placedIds.has(photo.id);
        const picked = pickedId === photo.id;
        const previewUrl = resolvePhotoUrl(photo, 'thumb');
        // Editing needs the worker's master (crop geometry is authored against it).
        const canEdit = photo.status === 'ready';
        const label = labelOf?.(photo.id) ?? null;

        return (
          <div
            key={photo.id}
            data-virtual-cell
            onFocusCapture={() => virtual.onItemFocus(i)}
            onBlurCapture={() => virtual.onItemFocus(null)}
            draggable={placeable}
            onDragStart={(e) => {
              if (!placeable) return;
                    startPhotoDrag(e, photo.id);
              // Publish the drag so destinations can preview it (Smart Replace).
              onDragStartPhoto?.(photo.id);
            }}
            onDragEnd={() => onDragEndPhoto?.()}
            onClick={(e) => {
              // Multi-selection takes precedence when a modifier is held or the host supplies a
              // selection store; plain clicks keep the existing tap-to-place behaviour.
              if (onSelect && (e.metaKey || e.ctrlKey || e.shiftKey)) {
                onSelect(photo.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }, orderedIds);
                return;
              }
              onSelect?.(photo.id, { meta: false, shift: false }, orderedIds);
              if (placeable && !placed) onPick?.(photo.id);
            }}
            onContextMenu={(e) => onContextMenu?.(e, photo.id)}
            aria-selected={isSelected?.(photo.id) ?? undefined}
            style={{ animationDelay: `${Math.min(i * 22, 260)}ms` }}
            className={`group relative aspect-square animate-scale-in overflow-hidden rounded-xl bg-muted shadow-xs ring-1 transition-all duration-200 ease-glide ${
              // Selection reads as a ring; "picked up for placing" keeps its brighter ring. Both
              // are ring-only so nothing shifts position when state changes.
              isSelected?.(photo.id)
                ? 'ring-2 ring-studio shadow-card'
                : picked
                  ? 'ring-2 ring-studio-bright shadow-card'
                  : 'ring-border'
            } ${
              placeable
                ? 'cursor-grab hover:-translate-y-0.5 hover:shadow-card hover:ring-2 hover:ring-studio-bright/60 active:scale-[0.98] active:cursor-grabbing'
                : ''
            }`}
            title={
              state === 'failed'
                ? `${photo.filename} — ${task?.error ?? 'could not be added'}`
                : optimistic && !placeable
                  ? `${photo.filename} — available in a moment`
                  : label
                    ? `${photo.filename} — ${LABEL_META[label].label}`
                    : photo.filename
            }
          >
            {previewUrl ? (
              <div
                className={`h-full w-full ${
                  placed ? 'opacity-40 saturate-[0.85]' : `transition-transform duration-[400ms] ease-glide group-hover:scale-[1.02] ${stateOpacityClass(state)}`
                }`}
              >
                <PhotoFrame
                  url={previewUrl}
                  edit={photo.edit}
                  alt={photo.filename}
                  lazy
                  onLoadError={previewUrl.startsWith('blob:') ? undefined : () => onImageError?.(photo.id)}
                />
              </div>
            ) : state === 'failed' ? (
              // TWO different failures, and the difference decides what the user should do:
              // an upload that never arrived can be retried as-is; a photo the processor
              // couldn't read needs a different file. Neither is phrased as alarming.
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] font-medium leading-tight text-foreground">
                  {task && task.photoId === null ? 'Upload stopped' : 'Couldn’t read this file'}
                </span>
                <span className="text-[9px] leading-tight text-muted-foreground">
                  {task && task.photoId === null ? 'Tap retry to send it again' : 'Try a different photo'}
                </span>
              </div>
            ) : (
              // No local preview (HEIC can't be decoded by the browser) — a quiet placeholder.
              // It says "Uploading", not "Processing": the distinction is ours, not the user's.
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-secondary/60 to-muted text-muted-foreground">
                <InlineLoader />
                <span className="text-[10px] font-medium">Uploading…</span>
              </div>
            )}

            {/* State chrome — nothing at all once ready. */}
            {previewUrl && !placed && <UploadBadge state={state} progress={task?.progress} />}

            {/* hover scrim so the controls always read */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/35 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

            {placed && (
              <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-studio px-1.5 py-0.5 text-[10px] font-semibold text-studio-foreground shadow-sm ring-1 ring-white/20 backdrop-blur-sm">
                <Check className="h-2.5 w-2.5" /> Placed
              </span>
            )}

            {/* Triage mark — a 3px hairline along the bottom edge. It never covers the picture,
                survives being scaled down to a 90px thumbnail, and reads as a colour code rather
                than another badge competing with the upload state at the top-left. */}
            {label && (
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-[3px] ${LABEL_META[label].dot}`}
              />
            )}

            {/* Favourite — client-only, always visible once set so it reads as state not chrome. */}
            {onToggleFavourite && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavourite(photo.id);
                }}
                aria-label={isFavourite?.(photo.id) ? `Unfavourite ${photo.filename}` : `Favourite ${photo.filename}`}
                aria-pressed={isFavourite?.(photo.id) ?? false}
                className={`absolute bottom-1.5 left-1.5 rounded-lg p-1 transition-all duration-200 ${
                  isFavourite?.(photo.id)
                    ? 'text-warning opacity-100'
                    : 'text-white/80 opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${isFavourite?.(photo.id) ? 'fill-current' : ''}`} />
              </button>
            )}

            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-all duration-200 focus-within:opacity-100 group-hover:opacity-100">
              {canEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(photo);
                  }}
                  aria-label={`Edit ${photo.filename}`}
                  className="rounded-lg bg-background/90 p-1.5 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-studio hover:text-studio-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}

              {state === 'failed' && task && onRetryUpload && task.photoId === null && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryUpload(task.id);
                  }}
                  aria-label={`Retry upload of ${photo.filename}`}
                  className="rounded-lg bg-background/90 p-1.5 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-studio hover:text-studio-foreground active:scale-[0.97]"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
              )}

              {/* An optimistic photo has no server row — cancelling is a client-side abort,
                  never a DELETE. A real photo keeps the existing delete path. */}
              {optimistic ? (
                task &&
                onCancelUpload && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelUpload(task.id);
                    }}
                    aria-label={`Cancel upload of ${photo.filename}`}
                    className="rounded-lg bg-background/90 p-1.5 text-destructive shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-destructive hover:text-destructive-foreground active:scale-[0.97]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(photo.id);
                  }}
                  disabled={deleting === photo.id}
                  aria-label={`Delete ${photo.filename}`}
                  className="rounded-lg bg-background/90 p-1.5 text-destructive shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                >
                  {deleting === photo.id ? <InlineLoader /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {virtual.padBottom > 0 && <div aria-hidden style={{ gridColumn: '1 / -1', height: virtual.padBottom }} />}
    </div>
  );
}
