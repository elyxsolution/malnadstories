'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { LOCATIONS } from '@/lib/builder/locations';

/**
 * Cover title / location autocomplete — a Google-suggest-style dropdown over a predefined dataset
 * of popular destinations. Fast prefix-then-substring matching, keyboard navigation (↑/↓/Enter/Esc),
 * mouse select, and bolded matching letters. Free typing is always allowed; suggestions are advisory.
 */

/** Highlight the matched span of `text` against the lowercased query. */
function highlight(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0 || q.length === 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-foreground">{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  );
}

export default function LocationAutocomplete({
  value,
  onChange,
  placeholder,
  maxLength = 100,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();

  const matches = useMemo(() => {
    if (q.length < 1) return [];
    const prefix: string[] = [];
    const sub: string[] = [];
    for (const loc of LOCATIONS) {
      const l = loc.toLowerCase();
      if (l === q) continue; // already an exact match — nothing to suggest
      if (l.startsWith(q)) prefix.push(loc);
      else if (l.includes(q)) sub.push(loc);
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (loc: string) => {
    onChange(loc);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(matches.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && matches.length > 0;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
      </div>

      {showList && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="animate-scale-in absolute z-[60] mt-1 max-h-64 w-full origin-top overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-elevated"
        >
          {matches.map((loc, i) => (
            <button
              key={loc}
              type="button"
              role="option"
              aria-selected={i === active}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(loc)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors ${
                i === active ? 'bg-secondary' : ''
              }`}
            >
              <MapPin className="h-3.5 w-3.5 flex-none text-studio" />
              <span className="truncate">{highlight(loc, q)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
