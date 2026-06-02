'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCw, FlipHorizontal, FlipVertical, Loader2, X } from 'lucide-react';
import { FULL_CROP, type EditConfig, type Rect } from '@/lib/builder/model';
import { savePhotoEdit } from '@/lib/actions/builder';
import PhotoFrame from './_photo-frame';
import { Button } from '@/components/ui/button';

const MIN_CROP = 0.08;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Handle = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Non-destructive photo editor. The LEFT canvas shows the full oriented (rotate +
 * flip) image at brightness/sharpness with an interactive rule-of-thirds crop rect
 * laid over it — so the crop is authored in the same space the renderer crops in.
 * The RIGHT "result" preview is just a PhotoFrame fed the real EditConfig, so it is
 * pixel-identical to what the slot and album preview show.
 */
export default function PhotoEditor({
  photoId,
  url,
  filename,
  initial,
  onClose,
  onSaved,
}: {
  photoId: string;
  url: string;
  filename: string;
  initial: EditConfig | null;
  onClose: () => void;
  onSaved: (edit: EditConfig) => void;
}) {
  const [edit, setEdit] = useState<EditConfig>(initial ?? {});
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState({ w: 0, h: 0 });
  const drag = useRef<{ mode: 'move' | Handle; x: number; y: number; rect: Rect } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [url]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setWrap({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const set = (patch: Partial<EditConfig>) => setEdit((e) => ({ ...e, ...patch }));
  const crop = edit.crop ?? FULL_CROP;

  // Oriented aspect: 90/270 swaps the natural dimensions. The canvas matches it so
  // the crop overlay maps 1:1 to the displayed image (no letterboxing).
  const quarter = (edit.rotate ?? 0) === 90 || (edit.rotate ?? 0) === 270;
  const ow = quarter ? nat.h : nat.w;
  const oh = quarter ? nat.w : nat.h;
  const orientedAspect = ow > 0 && oh > 0 ? ow / oh : 1;

  // Size the crop canvas in JS so it matches the oriented aspect EXACTLY within the
  // available area — fitting the crop overlay to the displayed image (CSS
  // aspect-ratio + max-height can violate the ratio and break the mapping).
  const canvas = (() => {
    if (wrap.w <= 0 || wrap.h <= 0) return { w: 0, h: 0 };
    let w = wrap.w;
    let h = w / orientedAspect;
    if (h > wrap.h) {
      h = wrap.h;
      w = h * orientedAspect;
    }
    return { w, h };
  })();

  // The crop canvas shows the image with crop disabled + tilt 0 (crop is defined on
  // the un-tilted oriented image; tilt straightens the framed crop afterwards).
  const baseEdit: EditConfig = {
    rotate: edit.rotate,
    flipH: edit.flipH,
    flipV: edit.flipV,
    brightness: edit.brightness,
    sharpness: edit.sharpness,
    crop: FULL_CROP,
    tilt: 0,
  };

  // ── crop rect drag / resize (fractions of the canvas = oriented image) ───────
  const startDrag = (mode: 'move' | Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, rect: crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!drag.current || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / r.width;
    const dy = (e.clientY - drag.current.y) / r.height;
    const o = drag.current.rect;

    if (drag.current.mode === 'move') {
      set({
        crop: { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) },
      });
      return;
    }

    // Resize from a corner: adjust the dragged edges, keep the opposite ones pinned.
    let { x, y, w, h } = o;
    const m = drag.current.mode;
    if (m === 'nw' || m === 'sw') {
      const nx = clamp(o.x + dx, 0, o.x + o.w - MIN_CROP);
      w = o.x + o.w - nx;
      x = nx;
    }
    if (m === 'ne' || m === 'se') {
      w = clamp(o.w + dx, MIN_CROP, 1 - o.x);
    }
    if (m === 'nw' || m === 'ne') {
      const ny = clamp(o.y + dy, 0, o.y + o.h - MIN_CROP);
      h = o.y + o.h - ny;
      y = ny;
    }
    if (m === 'sw' || m === 'se') {
      h = clamp(o.h + dy, MIN_CROP, 1 - o.y);
    }
    set({ crop: { x, y, w, h } });
  };
  const endDrag = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const rotate90 = () => {
    const next = (((edit.rotate ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
    // Orientation changed → the crop rect's frame swapped; reset to full.
    set({ rotate: next, crop: FULL_CROP });
  };
  const reset = () => setEdit({});

  const apply = async () => {
    setSaving(true);
    setError(null);
    const res = await savePhotoEdit({ photoId, edit });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(edit);
    onClose();
  };

  const handlePos: Record<Handle, string> = {
    nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
    ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
    sw: '-left-1.5 -bottom-1.5 cursor-nesw-resize',
    se: '-right-1.5 -bottom-1.5 cursor-nwse-resize',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="truncate text-sm font-semibold" title={filename}>
            Edit · {filename}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-[1fr_200px]">
          {/* Crop canvas */}
          <div ref={wrapRef} className="flex h-[55vh] items-center justify-center">
            <div
              ref={canvasRef}
              onPointerMove={onMove}
              className="relative touch-none select-none overflow-hidden rounded-lg border bg-muted"
              style={{ width: canvas.w, height: canvas.h }}
            >
              {nat.w > 0 && canvas.w > 0 && (
                <>
                  <PhotoFrame url={url} edit={baseEdit} alt={filename} />
                  {/* Crop rectangle with dimmed surroundings + rule-of-thirds grid */}
                  <div
                    onPointerDown={startDrag('move')}
                    onPointerUp={endDrag}
                    className="absolute cursor-move"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.w * 100}%`,
                      height: `${crop.h * 100}%`,
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                      outline: '1px solid rgba(255,255,255,0.9)',
                    }}
                  >
                    {/* thirds grid */}
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
                      <div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
                      <div className="absolute top-1/3 left-0 w-full h-px bg-white/40" />
                      <div className="absolute top-2/3 left-0 w-full h-px bg-white/40" />
                    </div>
                    {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => (
                      <div
                        key={h}
                        onPointerDown={startDrag(h)}
                        onPointerUp={endDrag}
                        className={`absolute h-3 w-3 rounded-sm border border-foreground bg-background ${handlePos[h]}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Live result (identical pipeline to slots + preview) + controls */}
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Result</p>
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md border bg-muted">
                <PhotoFrame url={url} edit={edit} alt="result preview" />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={rotate90}>
                <RotateCw /> 90°
              </Button>
              <Button
                variant={edit.flipH ? 'secondary' : 'outline'}
                size="icon-sm"
                onClick={() => set({ flipH: !edit.flipH })}
                aria-label="Flip horizontal"
              >
                <FlipHorizontal />
              </Button>
              <Button
                variant={edit.flipV ? 'secondary' : 'outline'}
                size="icon-sm"
                onClick={() => set({ flipV: !edit.flipV })}
                aria-label="Flip vertical"
              >
                <FlipVertical />
              </Button>
            </div>

            <Slider
              label="Straighten"
              value={edit.tilt ?? 0}
              min={-15}
              max={15}
              step={0.5}
              suffix="°"
              onChange={(v) => set({ tilt: v })}
            />
            <Slider
              label="Brightness"
              value={edit.brightness ?? 1}
              min={0.3}
              max={2}
              step={0.01}
              onChange={(v) => set({ brightness: v })}
            />
            <Slider
              label="Sharpness"
              value={edit.sharpness ?? 0}
              min={0}
              max={2}
              step={0.05}
              onChange={(v) => set({ sharpness: v })}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
            Reset all
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

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1 flex justify-between text-muted-foreground">
        <span>{label}</span>
        <span>
          {value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}
