'use client';

import { useState } from 'react';
import { Pencil, Trash2, Loader2, Check, AlertTriangle } from 'lucide-react';
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
  onEdit,
  onDeleted,
}: {
  photos: Photo[];
  placedIds: Set<string>;
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
    return <p className="text-sm text-muted-foreground">No photos yet — add some above.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo) => {
        const ready = photo.status === 'ready';
        const placed = placedIds.has(photo.id);
        return (
          <div
            key={photo.id}
            draggable={ready}
            onDragStart={(e) => {
              if (!ready) return;
              e.dataTransfer.setData('text/photo-id', photo.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className={`group relative aspect-square overflow-hidden rounded-md border bg-muted ${
              ready ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
            title={photo.filename}
          >
            {ready ? (
              <div className={placed ? 'h-full w-full opacity-40' : 'h-full w-full'}>
                <PhotoFrame url={photo.thumbUrl} edit={photo.edit} alt={photo.filename} />
              </div>
            ) : photo.status === 'pending' ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[10px]">Processing…</span>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-[10px] leading-tight">Couldn’t process</span>
              </div>
            )}

            {ready && placed && (
              <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-foreground/80 px-1 py-0.5 text-[10px] font-medium text-background">
                <Check className="h-3 w-3" /> Placed
              </span>
            )}

            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {ready && (
                <button
                  type="button"
                  onClick={() => onEdit(photo)}
                  aria-label={`Edit ${photo.filename}`}
                  className="rounded bg-background/85 p-1 shadow-sm hover:bg-background"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                disabled={deleting === photo.id}
                aria-label={`Delete ${photo.filename}`}
                className="rounded bg-background/85 p-1 text-destructive shadow-sm hover:bg-background disabled:opacity-50"
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
