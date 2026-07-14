'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { LOCATIONS } from '@/lib/builder/locations';
import { cn } from '@/lib/utils';

/**
 * Album-title smart input (Create-Album wizard). ONE field: the user types the album name
 * naturally, and whenever the text they are typing at a word boundary looks like a known
 * destination, location suggestions (from the shared `LOCATIONS` dataset) surface in a
 * dropdown beneath the input. Choosing one completes the location inline in the title AND
 * reports it via `onSelectLocation`, so the existing `destination` data flow is preserved —
 * without a separate field. Free typing is always allowed; suggestions are advisory.
 *
 * Matching model: a location is suggested when a WORD-ALIGNED trailing chunk of the input
 * (≥2 chars, starting at the text start or right after a space / - , / | : ·) is a prefix of
 * the location name. That recognises "Chik…", "… - Chi…" and "Our Coorg" while never firing
 * on arbitrary mid-word substrings. Keyboard: ↑/↓ move, Enter selects, Esc closes.
 */

const SEP = /[\s\-–—,/|:·@]/;

/** Word-start offsets in `lower` (index 0, and any char immediately after a separator). */
function wordStarts(lower: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (i === 0 || SEP.test(lower[i - 1]!)) starts.push(i);
  }
  return starts;
}

/** Longest word-aligned trailing chunk of `lower` that is a prefix of `locLower` (0 = none). */
function overlapLen(lower: string, locLower: string): number {
  // wordStarts is ascending, so index 0 (the longest chunk) is tested first.
  for (const i of wordStarts(lower)) {
    const chunk = lower.slice(i);
    if (chunk.length >= 2 && locLower.startsWith(chunk)) return chunk.length;
  }
  return 0;
}

/** Bold the matched leading `n` characters of a suggestion. */
function highlight(text: string, n: number): ReactNode {
  if (n <= 0) return text;
  return (
    <>
      <strong className="font-semibold text-foreground">{text.slice(0, n)}</strong>
      {text.slice(n)}
    </>
  );
}

export default function SmartTitleInput({
  value,
  onChange,
  onSelectLocation,
  placeholder,
  maxLength = 120,
  disabled = false,
  id,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fired when a suggestion is chosen — the parent records it as the album destination. */
  onSelectLocation: (loc: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  id?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const lower = value.toLowerCase().replace(/\s+$/, '');

  const matches = useMemo(() => {
    if (lower.length < 2) return [];
    const out: { loc: string; n: number }[] = [];
    for (const loc of LOCATIONS) {
      const n = overlapLen(lower, loc.toLowerCase());
      // Suggest on any word-aligned overlap, except when the input already IS this location.
      if (n >= 2 && loc.toLowerCase() !== lower) out.push({ loc, n });
    }
    out.sort((a, b) => b.n - a.n || a.loc.localeCompare(b.loc));
    return out.slice(0, 8);
  }, [lower]);

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

  // Complete the location the user is typing: replace the longest word-aligned trailing chunk
  // (that the location begins with) with the full location name, leaving the rest of the title.
  const choose = (loc: string) => {
    const lv = value.toLowerCase();
    const ll = loc.toLowerCase();
    let completed = value;
    for (const i of wordStarts(lv)) {
      const chunk = lv.slice(i);
      if (chunk.length >= 2 && ll.startsWith(chunk)) {
        completed = value.slice(0, i) + loc;
        break;
      }
    }
    if (completed === value && !lv.includes(ll)) {
      completed = value ? `${value.replace(/\s+$/, '')} ${loc}` : loc;
    }
    onChange(completed);
    onSelectLocation(loc);
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
      choose(matches[active]!.loc);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && matches.length > 0 && !disabled;

  return (
    <div ref={ref} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          if (!disabled) setOpen(true);
          setActive(-1);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        className={cn(
          'h-auto w-full border-0 border-b border-input bg-transparent px-0 py-2.5 font-display text-4xl font-medium leading-tight tracking-tight text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60 sm:text-5xl',
          inputClassName,
        )}
      />

      {showList && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="animate-scale-in absolute z-[60] mt-1 max-h-64 w-full origin-top overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-elevated"
        >
          {matches.map((m, i) => (
            <button
              key={m.loc}
              type="button"
              role="option"
              aria-selected={i === active}
              data-idx={i}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(m.loc)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted-foreground transition-colors ${
                i === active ? 'bg-secondary' : ''
              }`}
            >
              <MapPin className="h-3.5 w-3.5 flex-none text-studio" />
              <span className="truncate">{highlight(m.loc, m.n)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
