'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import type { UploadManagerApi } from '@/lib/uploads';

/**
 * The dropzone. It is now PURELY an input surface: validation, previews, queueing,
 * scheduling, progress, retry, cancel and the worker nudge all live in the Upload Manager
 * (`@/lib/uploads`), which every upload surface shares.
 *
 * Phase 1 gave uploads instant previews and took the worker wake off the critical path.
 * Phase 2 removed the last piece of upload logic from this component — dropping 100 files
 * now hands 100 tasks to a bounded FIFO queue instead of opening 100 parallel connections.
 *
 * `remaining` is the album-wide photo cap left (server enforces it as the real gate).
 */
export default function Uploader({
  albumId,
  remaining,
  uploads,
}: {
  albumId: string;
  remaining: number;
  /** Shared upload infrastructure — see `useUploadManager`. */
  uploads: UploadManagerApi;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Files already queued/uploading aren't photo rows yet, so they must be reserved against
  // the cap here or a batch could overshoot it and fail late at presign.
  const slotsLeft = remaining - uploads.stats.inFlight;

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      uploads.enqueue(files, albumId, Math.max(0, slotsLeft));
    },
    [uploads, albumId, slotsLeft],
  );

  return (
    /**
     * DENSITY PASS. This was a 180px centred column — a 48px icon, three stacked lines and 28px
     * of padding — which made sense for an empty album and stopped making sense about four
     * seconds later. After the first import a photographer spends all of their time browsing and
     * dragging thumbnails, so the dropzone's job changes from "invite" to "stay available", and
     * the space belongs to the grid.
     *
     * It is now a ~76px horizontal row: icon left, two lines of text right, file rules on one
     * compact line beneath. Every interaction is byte-for-byte the same — the same drag handlers
     * on the same element, the same hidden input, the same `slotsLeft` reservation against the
     * cap. Only the box got shorter.
     */
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border border-dashed px-3 py-2.5 transition-all duration-300 ease-glide ${
        dragOver
          ? 'border-studio-bright/70 bg-studio-soft shadow-glow'
          : 'border-border/80 bg-gradient-to-b from-secondary/40 to-background hover:border-studio-bright/40 hover:shadow-xs'
      } ${slotsLeft <= 0 ? 'pointer-events-none opacity-50' : ''}`}
    >
      {/* soft radial wash that lights up on hover/drag */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${dragOver ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
        style={{ background: 'radial-gradient(70% 100% at 50% 0%, hsl(var(--studio-bright) / 0.12), transparent 70%)' }}
      />

      <div className="relative flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg shadow-xs ring-1 transition-all duration-300 ease-glide ${
            dragOver
              ? 'scale-105 bg-studio text-studio-foreground ring-studio-bright/30'
              : 'bg-background text-studio ring-border group-hover:ring-studio-bright/30'
          }`}
        >
          <UploadCloud className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight tracking-tight">
            {slotsLeft > 0 ? (dragOver ? 'Drop to upload' : 'Add your photos') : 'Photo limit reached'}
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            Drag &amp; drop or <span className="font-medium text-foreground">browse</span>
          </span>
        </span>
      </div>

      {/* The file rules, one line, no pill — it is reference material, not a control. */}
      <p className="relative mt-1.5 truncate text-[10px] leading-tight text-muted-foreground/80">
        JPEG · PNG · HEIC · WebP · 20 MB · {Math.max(0, slotsLeft)} left
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
