'use client';

import { useId, type ReactNode } from 'react';

/**
 * Small, reusable inspector controls (sections, sliders, segmented toggles, colour rows).
 * Shared by the contextual Inspector and the photo editor so every control looks and feels
 * identical. Tokenized, accessible (labels + focus rings), tabular numerics.
 */

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border/60 px-4 py-4 first:border-t-0">
      {title && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>}
      {children}
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        {hint && <span className="text-[11px] tabular-nums text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  ariaLabel?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-studio outline-none focus-visible:ring-2 focus-visible:ring-studio-bright/40 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-studio [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label?: string; icon?: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-lg border border-border bg-secondary/60 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-all duration-150 [&_svg]:h-4 [&_svg]:w-4 ${
              active ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-none rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-2 ${
          checked ? 'bg-studio' : 'bg-secondary ring-1 ring-inset ring-border'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

const SWATCHES = ['#1e3a2f', '#0f1713', '#ffffff', '#fbf8f1', '#9a7b3f', '#b4452f', '#2c5446', '#6b7280'];

export function ColorRow({ value, onChange, allowTransparent }: { value: string; onChange: (hex: string) => void; allowTransparent?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SWATCHES.map((c) => (
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
          className={`grid h-6 w-6 place-items-center rounded-full bg-[conic-gradient(#0000_90deg,#ddd_0_180deg,#0000_0_270deg,#ddd_0)] bg-[length:8px_8px] ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
            value === 'transparent' ? 'ring-2 ring-studio ring-offset-1 ring-offset-card' : ''
          }`}
        />
      )}
      <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full ring-1 ring-inset ring-black/10">
        <span className="absolute inset-0 bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" />
        <input
          type="color"
          value={value === 'transparent' ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Custom colour"
        />
      </label>
    </div>
  );
}
