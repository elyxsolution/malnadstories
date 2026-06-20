'use client';

import { Search, Trash2, Loader2 } from 'lucide-react';

export type TrayFilter = 'all' | 'unplaced' | 'placed' | 'processing';

const CHIPS: { key: TrayFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unplaced', label: 'Unplaced' },
  { key: 'placed', label: 'Placed' },
  { key: 'processing', label: 'Processing' },
];

/**
 * Tray toolbar (client-only): search by filename, status filter chips, and a
 * "Remove unused" action that deletes ready + unplaced photos via the EXISTING
 * DELETE /api/photos/:id (no new endpoint). The parent owns the state + the delete.
 */
export default function TrayToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  removableCount,
  removing,
  onRemoveUnused,
}: {
  search: string;
  onSearch: (v: string) => void;
  filter: TrayFilter;
  onFilter: (f: TrayFilter) => void;
  removableCount: number;
  removing: boolean;
  onRemoveUnused: () => void;
}) {
  return (
    <div className="mb-3 space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search photos…"
          className="w-full border border-input bg-background py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-primary"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onFilter(c.key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {c.label}
            </button>
          );
        })}
        {removableCount > 0 && (
          <button
            type="button"
            onClick={onRemoveUnused}
            disabled={removing}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-destructive hover:underline disabled:opacity-50"
          >
            {removing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Remove unused ({removableCount})
          </button>
        )}
      </div>
    </div>
  );
}
