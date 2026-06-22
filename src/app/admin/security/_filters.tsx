'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search, X } from 'lucide-react';

type Active = { action?: string; range: string; q: string };

/**
 * Security Center filters (Phase 10C). Pure navigation — changing a control pushes a new
 * querystring; the server page re-queries. No client data fetching, no mutation.
 */
export default function SecurityFilters({
  actions,
  actionLabels,
  ranges,
  active,
}: {
  actions: readonly string[];
  actionLabels: Record<string, string>;
  ranges: readonly string[];
  active: Active;
}) {
  const router = useRouter();
  const [q, setQ] = useState(active.q);

  const go = (next: Partial<Active>) => {
    const merged = { ...active, ...next };
    const sp = new URLSearchParams();
    if (merged.action) sp.set('action', merged.action);
    if (merged.range && merged.range !== '7d') sp.set('range', merged.range);
    if (merged.q) sp.set('q', merged.q);
    const qs = sp.toString();
    router.push(qs ? `/admin/security?${qs}` : '/admin/security');
  };

  const Chip = ({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors active:scale-[0.97] ${
        selected ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Event</span>
        <Chip label="All" selected={!active.action} onClick={() => go({ action: undefined })} />
        {actions.map((a) => (
          <Chip key={a} label={actionLabels[a] ?? a} selected={active.action === a} onClick={() => go({ action: a })} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Range</span>
        {ranges.map((r) => (
          <Chip key={r} label={r === 'all' ? 'All time' : r} selected={active.range === r} onClick={() => go({ range: r })} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search action or detail…"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                go({ q: '' });
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted active:scale-[0.97]">
          Search
        </button>
      </form>
    </div>
  );
}
