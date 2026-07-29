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
      className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-7 text-center transition-all duration-300 ease-glide ${
        dragOver
          ? 'scale-[1.01] border-studio-bright/70 bg-studio-soft shadow-glow'
          : 'border-border/80 bg-gradient-to-b from-secondary/40 to-background hover:border-studio-bright/40 hover:shadow-card'
      } ${slotsLeft <= 0 ? 'pointer-events-none opacity-50' : ''}`}
    >
      {/* soft radial wash that lights up on hover/drag */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${dragOver ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
        style={{ background: 'radial-gradient(60% 70% at 50% 0%, hsl(var(--studio-bright) / 0.12), transparent 70%)' }}
      />
      <span
        className={`relative flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ring-1 transition-all duration-300 ease-glide ${
          dragOver
            ? 'scale-105 bg-studio text-studio-foreground ring-studio-bright/30'
            : 'bg-background text-studio ring-border group-hover:-translate-y-0.5 group-hover:ring-studio-bright/30'
        }`}
      >
        <UploadCloud className="h-5 w-5" />
      </span>
      <p className="relative mt-3 text-sm font-semibold tracking-tight">
        {slotsLeft > 0 ? (dragOver ? 'Drop to upload' : 'Add your photos') : 'Photo limit reached'}
      </p>
      <p className="relative mt-1 text-xs text-muted-foreground">
        Drag &amp; drop or <span className="font-medium text-foreground">browse</span>
      </p>
      <p className="relative mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground ring-1 ring-border/60">
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
