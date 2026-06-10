'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, X, ZoomIn, ZoomOut, Move } from 'lucide-react';
import { MAX_ZOOM, frameOverflow, type EditConfig } from '@/lib/builder/model';
import { savePhotoEdit } from '@/lib/actions/builder';
import PhotoFrame from './_photo-frame';
import { Button } from '@/components/ui/button';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Lightweight QUICK-CROP modal — fixed print frame, pan + zoom ONLY.
 *
 * Opened from a page block's photo (the "Adjust crop" control). The crop frame is fixed
 * to the printable area (frameAspect: 3:4 single page, 3:2 double spread, with the gutter
 * line). It edits ONLY zoom / offsetX / offsetY and PRESERVES every other edit (free crop,
 * rotate, tilt, flip, brightness, sharpen) — those live in the full editor. The viewport
 * is a PhotoFrame fed the live (composed) EditConfig, so it matches the slot + PDF exactly.
 */
export default function QuickCrop({
  photoId,
  url,
  filename,
  initial,
  frameAspect,
  showGutter,
  onClose,
  onSaved,
}: {
  photoId: string;
  url: string;
  filename: string;
  initial: EditConfig | null;
  frameAspect: number;
  showGutter: boolean;
  onClose: () => void;
  onSaved: (edit: EditConfig) => void;
}) {
  // Keep the FULL edit so other settings (crop/rotate/…) are preserved on save.
  const [edit, setEdit] = useState<EditConfig>(initial ?? {});
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWrap({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setZoomOff = (patch: Partial<Pick<EditConfig, 'zoom' | 'offsetX' | 'offsetY'>>) => setEdit((e) => ({ ...e, ...patch }));
  const zoom = edit.zoom ?? 1;

  const viewport = (() => {
    if (wrap.w <= 0 || wrap.h <= 0) return { w: 0, h: 0 };
    let w = wrap.w;
    let h = w / frameAspect;
    if (h > wrap.h) {
      h = wrap.h;
      w = h * frameAspect;
    }
    return { w, h };
  })();
  useEffect(() => setFrame({ w: viewport.w, h: viewport.h }), [viewport.w, viewport.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, offX: edit.offsetX ?? 0, offY: edit.offsetY ?? 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const ov = frameOverflow(frame.w, frame.h, nat.w, nat.h, edit);
    if (!ov) return;
    const doffX = ov.x > 0 ? (2 * (e.clientX - drag.current.x)) / ov.x : 0;
    const doffY = ov.y > 0 ? (2 * (e.clientY - drag.current.y)) / ov.y : 0;
    setZoomOff({ offsetX: clamp(drag.current.offX + doffX, -1, 1), offsetY: clamp(drag.current.offY + doffY, -1, 1) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => setZoomOff({ zoom: clamp(zoom + (e.deltaY < 0 ? 0.15 : -0.15), 1, MAX_ZOOM) });

  const apply = async () => {
    setSaving(true);
    setError(null);
    const res = await savePhotoEdit({ photoId, edit });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onSaved(edit);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="truncate text-sm font-semibold" title={filename}>
            Adjust crop · {filename}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div ref={wrapRef} className="mt-3 flex h-[55vh] items-center justify-center">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            className="relative cursor-move touch-none select-none overflow-hidden rounded-lg border bg-muted"
            style={{ width: viewport.w, height: viewport.h }}
          >
            {nat.w > 0 && viewport.w > 0 && <PhotoFrame url={url} edit={edit} alt={filename} />}
            {showGutter && (
              <>
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400/90" />
                <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-medium text-black">
                  Gutter — keep faces/text clear
                </span>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Move className="h-3.5 w-3.5" /> Drag · scroll to zoom
          </span>
          <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomOff({ zoom: Number(e.target.value) })}
            className="w-full"
          />
          <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="w-12 text-right text-xs text-muted-foreground">{zoom.toFixed(2)}×</span>
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setZoomOff({ zoom: 1, offsetX: 0, offsetY: 0 })} disabled={saving}>
            Reset position
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
