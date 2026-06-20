'use client';

import { useState } from 'react';
import { Pencil, Trash2, Loader2, Check, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import PhotoFrame from './_photo-frame';
import type { Photo } from './_uploader';

/**
 * The album's photo tray. Only 'ready' photos (sanitized derivatives in hand) are
 * draggable / editable / placeable; 'pending' shows a processing spinner and
 * 'rejected' an error. Thumbnails use the sanitized THUMB url, never the raw upload.
 * Delete hits DELETE /api/photos/:id and tells the parent to drop it from state.
 */
export default function Tray({
  photos,
  placedIds,
  pickedId = null,
  onPick,
  onEdit,
  onDeleted,
}: {
  photos: Photo[];
  placedIds: Set<string>;
  /** Tap-to-place: the photo currently "picked up" from the tray (ring), or null. */
  pickedId?: string | null;
  onPick?: (id: string) => void;
  onEdit: (photo: Photo) => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);

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
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-gradient-to-b from-secondary/30 to-transparent px-4 py-10 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-background text-muted-foreground/70 shadow-xs ring-1 ring-border">
          <ImageIcon className="h-5 w-5" />
        </div>
        <p className="mt-3 font-display text-base font-semibold tracking-tight">Your photos live here</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Add photos above, then drag them onto a page.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo, i) => {
        const ready = photo.status === 'ready';
        const placed = placedIds.has(photo.id);
        const picked = pickedId === photo.id;
        return (
          <div
            key={photo.id}
            draggable={ready}
            onDragStart={(e) => {
              if (!ready) return;
              e.dataTransfer.setData('text/photo-id', photo.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => ready && !placed && onPick?.(photo.id)}
            style={{ animationDelay: `${Math.min(i * 22, 260)}ms` }}
            className={`group relative aspect-square animate-scale-in overflow-hidden rounded-xl bg-muted shadow-xs ring-1 transition-all duration-200 ease-glide ${
              picked
                ? 'ring-2 ring-gold shadow-card'
                : 'ring-border/80'
            } ${
              ready
                ? 'cursor-grab hover:-translate-y-1 hover:shadow-card hover:ring-2 hover:ring-primary/50 active:scale-[0.97] active:cursor-grabbing'
                : ''
            }`}
            title={photo.filename}
          >
            {ready ? (
              <div className={placed ? 'h-full w-full opacity-40 saturate-[0.85]' : 'h-full w-full transition-transform duration-[400ms] ease-glide group-hover:scale-[1.05]'}>
                <PhotoFrame url={photo.thumbUrl} edit={photo.edit} alt={photo.filename} />
              </div>
            ) : photo.status === 'pending' ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-secondary/60 to-muted text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[10px] font-medium">Processing…</span>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-1 text-center text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-tight">Couldn’t process</span>
              </div>
            )}

            {/* hover scrim so the controls always read */}
            {ready && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/35 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            )}

            {ready && placed && (
              <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-success/95 px-1.5 py-0.5 text-[10px] font-semibold text-success-foreground shadow-sm ring-1 ring-white/20 backdrop-blur-sm">
                <Check className="h-2.5 w-2.5" /> Placed
              </span>
            )}

            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100">
              {ready && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(photo);
                  }}
                  aria-label={`Edit ${photo.filename}`}
                  className="rounded-lg bg-background/90 p-1.5 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
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
                {deleting === photo.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
