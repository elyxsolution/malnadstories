'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import type { EditConfig } from '@/lib/builder/model';

export type PhotoStatus = 'pending' | 'ready' | 'rejected';

export type Photo = {
  id: string;
  url: string; // sanitized full-res signed URL (empty until status='ready')
  thumbUrl: string; // sanitized thumbnail signed URL (empty until status='ready')
  filename: string;
  edit: EditConfig | null;
  status: PhotoStatus;
  takenAt: string | null;
  // Sanitized image dimensions (worker-populated). Read-only; used for the auto-layout
  // engine's orientation classification. Null until the photo is processed.
  width?: number | null;
  height?: number | null;
};

type Upload = {
  tempId: string;
  filename: string;
  progress: number; // 0–100
  status: 'uploading' | 'error';
  error?: string;
};

const ALLOWED = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_BYTES = 20 * 1024 * 1024;

// Browsers sometimes report an empty type for HEIC; fall back to the extension.
function resolveType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'heic') return 'image/heic';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return '';
}

// PUT the file straight to R2 with progress. fetch() can't report upload
// progress, so we use XHR. The browser sets Content-Length automatically.
function putToR2(url: string, file: File, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

/**
 * Upload-only dropzone. Reuses the existing presign → PUT → confirm R2 flow and
 * reports each finished photo to the parent via onUploaded; the parent (Builder)
 * owns the photo list / tray. `remaining` is the album-wide photo cap left.
 */
export default function Uploader({
  albumId,
  remaining,
  onUploaded,
  ensureWorkerReady,
}: {
  albumId: string;
  remaining: number;
  onUploaded: (photo: Photo) => void;
  // Gate that wakes the (sleepable) worker before uploads begin — the worker hardens
  // each upload, so starting one while it's unavailable would strand photos as
  // 'pending' until the next sweep. Resolves false if the user cancels the wake-up.
  ensureWorkerReady?: () => Promise<boolean>;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const inFlight = uploads.filter((u) => u.status === 'uploading').length;
  const slotsLeft = remaining - inFlight;

  const setUpload = (tempId: string, patch: Partial<Upload>) =>
    setUploads((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, ...patch } : u)));

  const uploadOne = useCallback(
    async (file: File) => {
      const tempId = crypto.randomUUID();
      const contentType = resolveType(file);

      if (!ALLOWED.includes(contentType)) {
        setUploads((p) => [
          ...p,
          { tempId, filename: file.name, progress: 0, status: 'error', error: 'Unsupported file type' },
        ]);
        return;
      }
      if (file.size > MAX_BYTES) {
        setUploads((p) => [
          ...p,
          { tempId, filename: file.name, progress: 0, status: 'error', error: 'File exceeds 20 MB' },
        ]);
        return;
      }

      setUploads((p) => [...p, { tempId, filename: file.name, progress: 0, status: 'uploading' }]);

      try {
        const presignRes = await fetch('/api/photos/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumId, filename: file.name, contentType, size: file.size }),
        });
        const presign = await presignRes.json();
        if (!presignRes.ok) throw new Error(presign.error || 'Could not start upload');

        await putToR2(presign.url, file, contentType, (pct) => setUpload(tempId, { progress: pct }));

        const confirmRes = await fetch('/api/photos/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ albumId, key: presign.key, originalFilename: file.name }),
        });
        const confirm = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirm.error || 'Could not save photo');

        // The photo enters 'pending'; the worker sanitizes it and the tray polls
        // until status='ready'. The raw upload is never served.
        onUploaded({
          id: confirm.id,
          url: '',
          thumbUrl: '',
          filename: file.name,
          edit: null,
          status: 'pending',
          takenAt: null,
        });
        setUploads((prev) => prev.filter((u) => u.tempId !== tempId));
      } catch (err) {
        setUpload(tempId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [albumId, onUploaded],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const batch = Array.from(files).slice(0, Math.max(0, slotsLeft));
      if (batch.length === 0) return;
      // Wake the worker before any bytes move — it hardens each upload, so we never
      // start while it's unavailable. Cancelling the wake-up aborts the whole batch.
      if (ensureWorkerReady && !(await ensureWorkerReady())) return;
      // Respect the album-wide cap on the client too (server enforces it as the gate).
      batch.forEach(uploadOne);
    },
    [slotsLeft, uploadOne, ensureWorkerReady],
  );

  return (
    <div className="space-y-3">
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

      {uploads.length > 0 && (
        <ul className="space-y-1.5">
          {uploads.map((u) => (
            <li key={u.tempId} className="animate-scale-in rounded-xl border bg-card/80 p-2.5 text-sm shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{u.filename}</span>
                <span className={`text-xs tabular-nums ${u.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {u.status === 'error' ? u.error : `${u.progress}%`}
                </span>
              </div>
              {u.status === 'uploading' && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-studio/80 to-studio transition-all duration-200"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
