'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCw, FlipHorizontal, FlipVertical, X, SlidersHorizontal, Maximize, Minimize } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import { FULL_CROP, type EditConfig, type Rect } from '@/lib/builder/model';

// Aspect-ratio presets for the crop rect. `null` = free. The ratio is the desired
// PIXEL aspect of the crop region; it's mapped into the normalized rect below.
const ASPECTS: { key: string; label: string; r: number | null }[] = [
  { key: 'free', label: 'Free', r: null },
  { key: '1:1', label: '1:1', r: 1 },
  { key: '4:3', label: '4:3', r: 4 / 3 },
  { key: '3:2', label: '3:2', r: 3 / 2 },
  { key: '16:9', label: '16:9', r: 16 / 9 },
];
import { savePhotoEdit } from '@/lib/actions/builder';
import PhotoFrame from './_photo-frame';
import { Button } from '@/components/ui/button';
import { STUDIO_PRIMARY } from './_ui';

const MIN_CROP = 0.08;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Handle = 'nw' | 'ne' | 'sw' | 'se';

/**
 * FULL advanced photo editor. The LEFT canvas shows the full oriented (rotate + flip)
 * image with an interactive **free-form crop rect** laid over it (resize from any
 * corner, drag to move) — so the crop is authored in the same space the renderer
 * crops in. The RIGHT "result" preview is a PhotoFrame fed the real EditConfig at the
 * photo's actual print frame aspect, so it is pixel-identical to the slot + PDF.
 *
 * This editor owns: crop (free-form), rotate, tilt/straighten, flip, brightness,
 * sharpness. It deliberately leaves zoom/offset (the fixed-frame QUICK crop) untouched
 * so the two systems compose — see model.ts. Overlays live on the page block, not here.
 */
export default function PhotoEditor({
  photoId,
  url,
  filename,
  initial,
  frameAspect,
  showGutter,
  onClose,
  onSaved,
  /**
   * WHERE THIS EDIT IS WRITTEN. Absent = the SOURCE photo's `photos.edit_config`, through the
   * existing `savePhotoEdit` action — which is what editing from the tray means and what this
   * modal has always done.
   *
   * A caller that opened the editor on a PLACEMENT supplies its own writer instead, so the crop
   * lands on that frame (`overlay.edit` / `block.baseEdits[slot]`) and every other placement of
   * the same image is untouched. Returning the same result shape either way keeps the error and
   * saving states below exactly as they were.
   */
  persist,
}: {
  photoId: string;
  url: string;
  filename: string;
  initial: EditConfig | null;
  frameAspect: number; // print frame aspect for the result preview (3:4 single, 3:2 double)
  showGutter: boolean;
  onClose: () => void;
  onSaved: (edit: EditConfig) => void;
  persist?: (edit: EditConfig) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [edit, setEdit] = useState<EditConfig>(initial ?? {});
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [aspectKey, setAspectKey] = useState<string>('free');
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

  const quarter = (edit.rotate ?? 0) === 90 || (edit.rotate ?? 0) === 270;
  const ow = quarter ? nat.h : nat.w;
  const oh = quarter ? nat.w : nat.h;
  const orientedAspect = ow > 0 && oh > 0 ? ow / oh : 1;

  // Constrain the crop rect to a target PIXEL aspect ratio (presets + Fill/Fit), centered
  // on the current crop. Writes ONLY the existing `crop` field — no new persistence.
  const setCropAspect = (r: number | null, key: string) => {
    setAspectKey(key);
    if (r === null || ow <= 0 || oh <= 0) return;
    const k = (r * oh) / ow; // normalized width:height
    let w = 1;
    let h = w / k;
    if (h > 1) {
      h = 1;
      w = k;
    }
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    set({ crop: { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h } });
  };
  // Fill = the whole image fills the frame (cover; edges may crop). Fit = crop matches the
  // frame aspect so the chosen region shows with nothing further cropped by the frame.
  const fillFrame = () => {
    setAspectKey('free');
    set({ crop: FULL_CROP });
  };
  const fitFrame = () => setCropAspect(frameAspect, 'fit');

  // Size the crop canvas so it matches the oriented aspect EXACTLY within the area.
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

  // The crop canvas shows the whole oriented image: crop full, tilt 0, and NO fixed-frame
  // zoom/pan (those belong to quick crop) so the free-crop rect maps 1:1 to the image.
  const baseEdit: EditConfig = {
    rotate: edit.rotate,
    flipH: edit.flipH,
    flipV: edit.flipV,
    brightness: edit.brightness,
    sharpness: edit.sharpness,
    crop: FULL_CROP,
    tilt: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };

  // ── free crop rect drag / resize (fractions of the oriented image) ───────────
  const startDrag = (mode: 'move' | Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (mode !== 'move') setAspectKey('free'); // manual corner resize → free crop
    drag.current = { mode, x: e.clientX, y: e.clientY, rect: crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!drag.current || !c) return;
    const r = c.getBoundingClientRect();
    const dx = (e.clientX - drag.current.x) / r.width;
    const dy = (e.clientY - drag.current.y) / r.height;
    const o = drag.current.rect;

    if (drag.current.mode === 'move') {
      set({ crop: { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) } });
      return;
    }
    let { x, y, w, h } = o;
    const m = drag.current.mode;
    if (m === 'nw' || m === 'sw') {
      const nx = clamp(o.x + dx, 0, o.x + o.w - MIN_CROP);
      w = o.x + o.w - nx;
      x = nx;
    }
    if (m === 'ne' || m === 'se') w = clamp(o.w + dx, MIN_CROP, 1 - o.x);
    if (m === 'nw' || m === 'ne') {
      const ny = clamp(o.y + dy, 0, o.y + o.h - MIN_CROP);
      h = o.y + o.h - ny;
      y = ny;
    }
    if (m === 'sw' || m === 'se') h = clamp(o.h + dy, MIN_CROP, 1 - o.y);
    set({ crop: { x, y, w, h } });
  };
  const endDrag = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  const rotate90 = () => {
    const next = (((edit.rotate ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
    setAspectKey('free');
    set({ rotate: next, crop: FULL_CROP }); // orientation changed → reset the crop frame
  };
  const reset = () => {
    setAspectKey('free');
    setEdit({});
  };

  const apply = async () => {
    setSaving(true);
    setError(null);
    const res = persist ? await persist(edit) : await savePhotoEdit({ photoId, edit });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-rise max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border bg-background shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Edit photo</p>
              <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight" title={filename}>
                {filename}
              </h2>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1fr_208px]">
          {/* Free-form crop canvas on a recessed dark stage */}
          <div
            ref={wrapRef}
            className="flex h-[55vh] items-center justify-center rounded-xl p-3 ring-1 ring-inset ring-black/20"
            style={{ background: 'radial-gradient(120% 100% at 50% 0%, hsl(160 14% 14%), hsl(162 18% 9%))' }}
          >
            <div
              ref={canvasRef}
              onPointerMove={onMove}
              className="relative touch-none select-none overflow-hidden rounded-lg border bg-muted"
              style={{ width: canvas.w, height: canvas.h }}
            >
              {nat.w > 0 && canvas.w > 0 && (
                <>
                  <PhotoFrame url={url} edit={baseEdit} alt={filename} />
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
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
                      <div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
                      <div className="absolute top-1/3 left-0 h-px w-full bg-white/40" />
                      <div className="absolute top-2/3 left-0 h-px w-full bg-white/40" />
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

          {/* Live result (real print frame aspect) + controls */}
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Result (print frame)</p>
              <div
                className="relative w-full overflow-hidden rounded-md border bg-muted"
                style={{ aspectRatio: String(frameAspect) }}
              >
                <PhotoFrame url={url} edit={edit} alt="result preview" />
                {showGutter && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-amber-400/90" />}
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={rotate90}>
                <RotateCw /> 90°
              </Button>
              <Button variant={edit.flipH ? 'secondary' : 'outline'} size="icon-sm" onClick={() => set({ flipH: !edit.flipH })} aria-label="Flip horizontal">
                <FlipHorizontal />
              </Button>
              <Button variant={edit.flipV ? 'secondary' : 'outline'} size="icon-sm" onClick={() => set({ flipV: !edit.flipV })} aria-label="Flip vertical">
                <FlipVertical />
              </Button>
            </div>

            {/* Fill / Fit — both map to the existing crop field (no new persistence). */}
            <div className="flex gap-2">
              <Button variant={aspectKey === 'free' ? 'secondary' : 'outline'} size="sm" className="flex-1" onClick={fillFrame}>
                <Maximize /> Fill
              </Button>
              <Button variant={aspectKey === 'fit' ? 'secondary' : 'outline'} size="sm" className="flex-1" onClick={fitFrame}>
                <Minimize /> Fit
              </Button>
            </div>

            {/* Aspect-ratio crop presets. */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground/80">Aspect</p>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => setCropAspect(a.r, a.key)}
                    className={`rounded-[2px] border px-2 py-1 text-[11px] font-medium transition-colors ${
                      aspectKey === a.key
                        ? 'border-studio bg-studio text-studio-foreground'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <Slider label="Straighten" value={edit.tilt ?? 0} min={-15} max={15} step={0.5} suffix="°" onChange={(v) => set({ tilt: v })} />
            <Slider label="Brightness" value={edit.brightness ?? 1} min={0.3} max={2} step={0.01} onChange={(v) => set({ brightness: v })} />
            <Slider label="Sharpness" value={edit.sharpness ?? 0} min={0} max={2} step={0.05} onChange={(v) => set({ sharpness: v })} />
            <p className="text-[11px] text-muted-foreground">Tip: use “Adjust crop” on the page for quick pan/zoom inside the print frame.</p>
          </div>
        </div>

        {error && <p className="px-4 text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
            Reset all
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply} disabled={saving} className={STUDIO_PRIMARY}>
              {saving && <InlineLoader />} Apply
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
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="block text-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-medium text-foreground/80">{label}</span>
        <span className="rounded bg-secondary px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground">
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
        className="lux-range"
        style={{
          background: `linear-gradient(to right, hsl(var(--studio)) ${fill}%, hsl(var(--muted)) ${fill}%)`,
        }}
      />
    </label>
  );
}
