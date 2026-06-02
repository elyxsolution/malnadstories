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
}: {
  albumId: string;
  remaining: number;
  onUploaded: (photo: Photo) => void;
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
    (files: FileList | null) => {
      if (!files) return;
      // Respect the album-wide cap on the client too (server enforces it as the gate).
      Array.from(files).slice(0, Math.max(0, slotsLeft)).forEach(uploadOne);
    },
    [slotsLeft, uploadOne],
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
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? 'border-foreground bg-muted' : 'border-muted-foreground/30'
        } ${slotsLeft <= 0 ? 'pointer-events-none opacity-50' : ''}`}
      >
        <UploadCloud className="h-7 w-7 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">
          {slotsLeft > 0 ? 'Add photos' : 'Photo limit reached'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          JPEG, PNG, HEIC, WebP · up to 20 MB · {Math.max(0, slotsLeft)} more allowed
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
        <ul className="space-y-2">
          {uploads.map((u) => (
            <li key={u.tempId} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{u.filename}</span>
                <span className={u.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                  {u.status === 'error' ? u.error : `${u.progress}%`}
                </span>
              </div>
              {u.status === 'uploading' && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div className="h-full bg-foreground transition-all" style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
