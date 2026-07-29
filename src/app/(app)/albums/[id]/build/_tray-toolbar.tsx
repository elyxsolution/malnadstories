'use client';

import { useState } from 'react';
import { Search, Trash2, Star, X, HelpCircle } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import type { OrientationFilter, ParsedSearch, StateFilter, TrayFilters, UsageFilter } from './_tray-filters';
import { SEARCH_HINTS } from './_tray-filters';
import { LABEL_LIST, type PhotoLabel } from './_photo-labels';

/**
 * Tray toolbar — search plus COMPOSABLE filter chips.
 *
 * The chips used to be a single-choice row: picking "Unplaced" meant giving up "portrait". Now
 * each axis is independent and combines with AND, which is what a filter bar is normally expected
 * to do. Chips are `aria-pressed` toggles rather than a radio group, so assistive tech describes
 * them the way they now behave.
 *
 * PHASE 7 adds two things and changes nothing else. Label chips join the row as another
 * independent axis, and the search box gains `key:value` terms (`is:unused`, `label:replace`)
 * parsed by `_tray-filters` — so a typed term and a clicked chip are the same predicate. When a
 * term is recognised the toolbar says so in one quiet line, because a search box that silently
 * behaves differently from what you typed is worse than one that can't.
 *
 * Presentational only: it renders the filter state it is given and reports toggles back. The
 * predicates live in `_tray-filters`, and "Remove unused" still goes through the existing
 * `DELETE /api/photos/:id` the parent owns.
 */

const USAGE: { key: UsageFilter; label: string }[] = [
  { key: 'unplaced', label: 'Unused' },
  { key: 'placed', label: 'Used' },
];
const ORIENTATION: { key: OrientationFilter; label: string }[] = [
  { key: 'portrait', label: 'Portrait' },
  { key: 'landscape', label: 'Landscape' },
  { key: 'square', label: 'Square' },
];
const STATE: { key: StateFilter; label: string }[] = [
  { key: 'processing', label: 'Processing' },
  { key: 'failed', label: 'Failed' },
];

function Chip({
  label,
  active,
  onClick,
  icon,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
        active
          ? 'border-studio bg-studio text-studio-foreground'
          : 'border-input bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** One line naming what the typed terms are doing — only when at least one was understood. */
function TermSummary({ parsed }: { parsed: ParsedSearch }) {
  const parts: string[] = [];
  if (parsed.usage.size > 0) parts.push(Array.from(parsed.usage).map((u) => (u === 'placed' ? 'used' : 'unused')).join(' or '));
  if (parsed.orientation.size > 0) parts.push(Array.from(parsed.orientation).join(' or '));
  if (parsed.state.size > 0) parts.push(Array.from(parsed.state).join(' or '));
  if (parsed.labels.size > 0) parts.push(Array.from(parsed.labels).map((l) => `marked ${l}`).join(' or '));
  if (parsed.favouritesOnly) parts.push('favourites');
  if (parts.length === 0) return null;
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Filtering by <span className="font-medium text-foreground">{parts.join(' · ')}</span>
      {parsed.text ? (
        <>
          {' '}
          matching <span className="font-medium text-foreground">“{parsed.text}”</span>
        </>
      ) : null}
    </p>
  );
}

export default function TrayToolbar({
  filters,
  parsedSearch,
  onSearch,
  onToggleAxis,
  onToggleFavourites,
  onReset,
  active,
  matchCount,
  totalCount,
  favouriteCount,
  labelCounts,
  removableCount,
  removing,
  onRemoveUnused,
}: {
  filters: TrayFilters;
  /** The parsed form of `filters.search` — supplied, never re-parsed here. */
  parsedSearch: ParsedSearch;
  onSearch: (v: string) => void;
  onToggleAxis: <K extends 'usage' | 'orientation' | 'state' | 'labels'>(
    axis: K,
    value: TrayFilters[K] extends Set<infer V> ? V : never,
  ) => void;
  onToggleFavourites: () => void;
  onReset: () => void;
  active: boolean;
  matchCount: number;
  totalCount: number;
  favouriteCount: number;
  /** How many photos carry each label — a chip with nothing behind it isn't shown. */
  labelCounts: Record<PhotoLabel, number>;
  removableCount: number;
  removing: boolean;
  onRemoveUnused: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const anyLabels = LABEL_LIST.some((l) => labelCounts[l.key] > 0);

  return (
    <div className="mb-3 space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filters.search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search — name, is:unused, label:replace…"
          aria-label="Search photos by name, or filter with terms like is:unused and label:replace"
          aria-describedby="tray-search-help"
          className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-8 text-[13px] outline-none transition-colors focus:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/30"
        />
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          aria-label="What can I search for?"
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The vocabulary, on request. Rendered from the SAME list the parser accepts. */}
      {helpOpen && (
        <div
          id="tray-search-help"
          className="motion-safe:animate-scale-in space-y-1 rounded-lg border border-border/70 bg-secondary/40 p-2.5"
          style={{ transformOrigin: 'top right' }}
        >
          <p className="text-[11px] font-medium text-foreground">Type any of these, on their own or with a name:</p>
          {SEARCH_HINTS.map((h) => (
            <p key={h.term} className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
              <code className="rounded bg-background px-1 py-px font-mono text-[10.5px] text-foreground ring-1 ring-border/70">
                {h.term}
              </code>
              {h.means}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {USAGE.map((c) => (
          <Chip key={c.key} label={c.label} active={filters.usage.has(c.key)} onClick={() => onToggleAxis('usage', c.key)} />
        ))}
        {ORIENTATION.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            active={filters.orientation.has(c.key)}
            onClick={() => onToggleAxis('orientation', c.key)}
          />
        ))}
        {STATE.map((c) => (
          <Chip key={c.key} label={c.label} active={filters.state.has(c.key)} onClick={() => onToggleAxis('state', c.key)} />
        ))}
        {favouriteCount > 0 && (
          <Chip
            label="Favourites"
            active={filters.favouritesOnly}
            onClick={onToggleFavourites}
            icon={<Star className={`h-3 w-3 ${filters.favouritesOnly ? 'fill-current' : ''}`} />}
          />
        )}
      </div>

      {/* Label chips get their own row — they are a different KIND of question ("where is this
          in my process") and mixing them into the shape/state row makes both harder to scan. */}
      {anyLabels && (
        <div className="flex flex-wrap items-center gap-1.5">
          {LABEL_LIST.filter((l) => labelCounts[l.key] > 0).map((l) => {
            const on = filters.labels.has(l.key);
            return (
              <Chip
                key={l.key}
                label={`${l.label} · ${labelCounts[l.key]}`}
                active={on}
                title={l.hint}
                onClick={() => onToggleAxis('labels', l.key)}
                icon={<span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-current' : l.dot}`} aria-hidden />}
              />
            );
          })}
        </div>
      )}

      {parsedSearch.hasTerms && <TermSummary parsed={parsedSearch} />}

      {/* A live count, only while filtering — otherwise a narrowed list can look empty for no
          visible reason. */}
      {active && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span aria-live="polite">
            {matchCount} of {totalCount} {totalCount === 1 ? 'photo' : 'photos'}
          </span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 font-medium text-foreground transition-colors hover:text-studio"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        </div>
      )}

      {removableCount > 0 && (
        <button
          type="button"
          onClick={onRemoveUnused}
          disabled={removing}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
        >
          {removing ? <InlineLoader /> : <Trash2 className="h-3.5 w-3.5" />}
          Remove {removableCount} unused
        </button>
      )}
    </div>
  );
}
