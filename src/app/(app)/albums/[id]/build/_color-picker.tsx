'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';

/**
 * Professional colour picker — a full HSV spectrum (saturation/value square + hue slider), hex +
 * RGB inputs, preset swatches, and per-browser RECENT + SAVED colours (localStorage). Exposed as
 * `ColorField`, a drop-in replacement for the old preset-only `ColorRow` (same
 * `{ value, onChange, allowTransparent }` API), so the cover and every page element share one
 * picker. Pure CSS/canvas math — no new dependency.
 */

const PRESETS = ['#1e3a2f', '#0f1713', '#ffffff', '#fbf8f1', '#9a7b3f', '#b4452f', '#2c5446', '#6b7280'];
const RECENT_KEY = 'ms-color-recent';
const SAVED_KEY = 'ms-color-saved';
const CHECKER = 'conic-gradient(#0000 90deg,#ddd 0 180deg,#0000 0 270deg,#ddd 0) 0 0 / 8px 8px';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function ColorField({
  value,
  onChange,
  allowTransparent,
}: {
  value: string;
  onChange: (hex: string) => void;
  allowTransparent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const isTransparent = value === 'transparent';

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.slice(0, 6).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            onClick={() => onChange(c)}
            style={{ background: c }}
            className={`h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
              value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-studio ring-offset-1 ring-offset-card' : ''
            }`}
          />
        ))}
        {allowTransparent && (
          <button
            type="button"
            aria-label="Transparent"
            onClick={() => onChange('transparent')}
            style={{ background: CHECKER }}
            className={`h-6 w-6 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
              isTransparent ? 'ring-2 ring-studio ring-offset-1 ring-offset-card' : ''
            }`}
          />
        )}
        {/* Custom trigger — opens the full spectrum picker */}
        <button
          type="button"
          aria-label="Custom colour"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-6 w-6 place-items-center rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110"
          style={{ background: isTransparent ? CHECKER : value }}
        >
          {isTransparent ? <X className="h-3 w-3 text-foreground/60" /> : <Plus className="h-3 w-3 text-white mix-blend-difference" />}
        </button>
      </div>

      {open && <ColorPopover value={value} onChange={onChange} allowTransparent={allowTransparent} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ColorPopover({
  value,
  onChange,
  allowTransparent,
  onClose,
}: {
  value: string;
  onChange: (hex: string) => void;
  allowTransparent?: boolean;
  onClose: () => void;
}) {
  const initial = hexToRgb(value === 'transparent' ? '#1e3a2f' : value) ?? { r: 30, g: 58, b: 47 };
  const [hsv, setHsv] = useState(() => rgbToHsv(initial.r, initial.g, initial.b));
  const [hex, setHex] = useState(value === 'transparent' ? '#1e3a2f' : value);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    setRecent(readList(RECENT_KEY));
    setSaved(readList(SAVED_KEY));
  }, []);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const currentHex = rgbToHex(rgb.r, rgb.g, rgb.b);

  // Commit a colour: notify + push to recent (deduped, last 10).
  const commit = (h: string) => {
    onChange(h);
    const next = [h.toLowerCase(), ...recent.filter((c) => c.toLowerCase() !== h.toLowerCase())].slice(0, 10);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const setFromHsv = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const r = hsvToRgb(next.h, next.s, next.v);
    const h = rgbToHex(r.r, r.g, r.b);
    setHex(h);
    onChange(h); // live update; commit (recent) on release / explicit pick
  };

  const setFromHex = (h: string) => {
    setHex(h);
    const rgbv = hexToRgb(h);
    if (rgbv) {
      setHsv(rgbToHsv(rgbv.r, rgbv.g, rgbv.b));
      onChange(rgbToHex(rgbv.r, rgbv.g, rgbv.b));
    }
  };

  const setChannel = (ch: 'r' | 'g' | 'b', v: number) => {
    const next = { ...rgb, [ch]: clamp(v, 0, 255) };
    const h = rgbToHex(next.r, next.g, next.b);
    setFromHex(h);
  };

  const saveCurrent = () => {
    const next = [currentHex.toLowerCase(), ...saved.filter((c) => c.toLowerCase() !== currentHex.toLowerCase())].slice(0, 12);
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // Pointer drag on the SV square.
  const svRef = useRef<HTMLDivElement>(null);
  const onSvPointer = (e: React.PointerEvent) => {
    const box = svRef.current?.getBoundingClientRect();
    if (!box) return;
    const s = clamp((e.clientX - box.left) / box.width, 0, 1);
    const v = clamp(1 - (e.clientY - box.top) / box.height, 0, 1);
    setFromHsv({ h: hsv.h, s, v });
  };
  const hueRef = useRef<HTMLDivElement>(null);
  const onHuePointer = (e: React.PointerEvent) => {
    const box = hueRef.current?.getBoundingClientRect();
    if (!box) return;
    const h = clamp((e.clientX - box.left) / box.width, 0, 1) * 360;
    setFromHsv({ h, s: hsv.s, v: hsv.v });
  };
  const dragging = useRef<null | 'sv' | 'hue'>(null);

  const hueColor = (() => {
    const r = hsvToRgb(hsv.h, 1, 1);
    return rgbToHex(r.r, r.g, r.b);
  })();

  return (
    <div className="animate-scale-in absolute right-0 z-[70] mt-2 w-60 origin-top-right rounded-xl border border-border bg-card p-3 shadow-elevated">
      {/* SV square */}
      <div
        ref={svRef}
        onPointerDown={(e) => {
          dragging.current = 'sv';
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onSvPointer(e);
        }}
        onPointerMove={(e) => dragging.current === 'sv' && onSvPointer(e)}
        onPointerUp={(e) => {
          dragging.current = null;
          commit(currentHex);
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: currentHex }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        onPointerDown={(e) => {
          dragging.current = 'hue';
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onHuePointer(e);
        }}
        onPointerMove={(e) => dragging.current === 'hue' && onHuePointer(e)}
        onPointerUp={(e) => {
          dragging.current = null;
          commit(currentHex);
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
        className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }}
        />
      </div>

      {/* Hex + RGB */}
      <div className="mt-3 flex items-center gap-1.5">
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            const rgbv = hexToRgb(hex);
            if (rgbv) commit(rgbToHex(rgbv.r, rgbv.g, rgbv.b));
            else setHex(currentHex);
          }}
          aria-label="Hex colour"
          className="h-8 w-20 rounded-md border border-input bg-card px-2 text-[12px] tabular-nums outline-none focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
        {(['r', 'g', 'b'] as const).map((ch) => (
          <input
            key={ch}
            type="number"
            min={0}
            max={255}
            value={Math.round(rgb[ch])}
            onChange={(e) => setChannel(ch, parseInt(e.target.value || '0', 10))}
            onBlur={() => commit(currentHex)}
            aria-label={ch.toUpperCase()}
            className="h-8 w-12 rounded-md border border-input bg-card px-1.5 text-center text-[12px] tabular-nums outline-none focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
          />
        ))}
      </div>

      {/* Presets */}
      <Swatches title="Presets" colors={PRESETS} value={value} onPick={commit} />
      {recent.length > 0 && <Swatches title="Recent" colors={recent} value={value} onPick={commit} />}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saved</span>
        <button type="button" onClick={saveCurrent} title="Save current colour" className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-studio hover:bg-studio-soft">
          <Plus className="h-3 w-3" /> Save
        </button>
      </div>
      {saved.length > 0 ? (
        <Swatches colors={saved} value={value} onPick={commit} />
      ) : (
        <p className="mt-0.5 text-[10px] text-muted-foreground">Save colours to reuse them across albums.</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        {allowTransparent && (
          <button
            type="button"
            onClick={() => {
              onChange('transparent');
              onClose();
            }}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-secondary"
          >
            Transparent
          </button>
        )}
        <button type="button" onClick={onClose} className="ml-auto rounded-md bg-studio px-3 py-1 text-[12px] font-semibold text-studio-foreground hover:bg-[hsl(150_48%_29%)]">
          Done
        </button>
      </div>
    </div>
  );
}

function Swatches({ title, colors, value, onPick }: { title?: string; colors: string[]; value: string; onPick: (hex: string) => void }) {
  return (
    <div className="mt-2">
      {title && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            aria-label={`Colour ${c}`}
            onClick={() => onPick(c)}
            style={{ background: c }}
            className={`h-5 w-5 rounded-md ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
              value.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-studio ring-offset-1 ring-offset-card' : ''
            }`}
          >
            {value.toLowerCase() === c.toLowerCase() && <Check className="mx-auto h-3 w-3 text-white mix-blend-difference" />}
          </button>
        ))}
      </div>
    </div>
  );
}
