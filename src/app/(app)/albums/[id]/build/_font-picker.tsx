'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { FONT_CATALOG, fontStack, fontLabel, type FontKey } from '@/lib/builder/fonts-catalog';

/**
 * Font picker — a popover that lists every library font rendered IN ITS OWN TYPEFACE (live
 * preview), with keyboard navigation + mouse select. The single font control shared by the
 * text inspector AND the cover, so typography is identical on pages and the cover.
 */
export default function FontPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (key: FontKey) => void;
  /**
   * Toolbar form (Pass 3): a 7-high trigger sized for the floating context bar, with the same
   * live-preview dropdown. One component, two hosts — the panel and the bar never drift.
   */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open at the current selection.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, FONT_CATALOG.findIndex((f) => f.key === value));
    setActive(idx);
  }, [open, value]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (key: FontKey) => {
    onChange(key);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(FONT_CATALOG.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(FONT_CATALOG[active].key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Close only the dropdown — never let Escape bubble on to dismiss the hosting toolbar.
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-bar-item={compact ? true : undefined}
        title={compact ? 'Font' : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        aria-label="Font"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          compact
            ? 'flex h-7 w-[7.5rem] items-center justify-between gap-1.5 rounded-lg px-2 text-[12px] text-foreground outline-none transition-colors duration-100 hover:bg-secondary focus-visible:ring-2 focus-visible:ring-studio-bright'
            : 'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all hover:border-studio-bright/60 focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40'
        }
      >
        <span className="truncate" style={{ fontFamily: fontStack(value) }}>
          {fontLabel(value)}
        </span>
        <ChevronDown
          className={`flex-none text-muted-foreground transition-transform ${compact ? 'h-3 w-3 opacity-70' : 'h-4 w-4'} ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Font"
          className={`animate-scale-in absolute z-[80] mt-1 max-h-72 origin-top overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-elevated ${
            compact ? 'left-0 w-56' : 'w-full'
          }`}
        >
          {FONT_CATALOG.map((f, i) => {
            const selected = f.key === value;
            return (
              <button
                key={f.key}
                type="button"
                role="option"
                aria-selected={selected}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(f.key)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  i === active ? 'bg-secondary' : ''
                }`}
              >
                <span className="truncate text-[15px] leading-snug text-foreground" style={{ fontFamily: fontStack(f.key) }}>
                  {f.label}
                </span>
                {selected && <Check className="h-4 w-4 flex-none text-studio" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
