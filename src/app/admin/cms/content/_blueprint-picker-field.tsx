'use client';

import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, X, Plus, Search } from 'lucide-react';
import BlueprintCover from '@/components/blueprint-cover';
import { blueprintRefsFrom } from '@/lib/cms/blueprint-refs';
import type { CoverConfig } from '@/lib/builder/cover';

/**
 * THE CMS DESIGN PICKER — how an editor curates a shelf.
 *
 * NO ONE TYPES A UUID. The editor sees the actual front covers, exactly as a visitor will, and
 * selects, reorders and removes them directly. That is the whole point of the field: the ids are
 * an implementation detail of the storage, not something a person should ever handle.
 *
 * IT RENDERS THE REAL COVER. `BlueprintCover` is the same component the public gallery and the
 * blueprint catalog use, so what the editor arranges is what the page will show — not an
 * approximation of it, and not a stale thumbnail.
 *
 * SELECTION ORDER IS THE PUBLISHED ORDER. The chosen list is a sequence the editor controls with
 * the up/down controls; `resolveBlueprintRefs` renders in exactly that order and never re-sorts by
 * merchandising flags. Buttons rather than drag-and-drop: reordering four covers is a two-click
 * job, and a drag surface here would be a keyboard-accessibility problem to solve for no gain.
 *
 * The value is normalised through the SAME `blueprintRefsFrom` the server reads with, so the
 * editor and the renderer cannot disagree about what a selection is.
 */

export type PickableBlueprint = {
  id: string;
  name: string;
  categoryLabel: string;
  pageCount: number;
  cover: CoverConfig | null;
};

export default function BlueprintPickerField({
  value,
  options,
  stickerUrls,
  onChange,
}: {
  /** The raw metadata value — anything, because it comes from free-form jsonb. */
  value: unknown;
  options: PickableBlueprint[];
  stickerUrls: Record<string, string>;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const selectedIds = useMemo(() => blueprintRefsFrom({ blueprintIds: value }), [value]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const stickerUrlFor = (id: string) => stickerUrls[id];

  // A selected design whose row has since been deactivated or deleted resolves to nothing here.
  // It is shown as a removable "unavailable" chip rather than silently dropped, so an editor can
  // SEE that the shelf lost an entry instead of wondering why the page shows three of four.
  const selected = selectedIds.map((id) => ({ id, bp: byId.get(id) ?? null }));

  const q = query.trim().toLowerCase();
  const available = options.filter(
    (o) => !selectedIds.includes(o.id) && (!q || o.name.toLowerCase().includes(q) || o.categoryLabel.toLowerCase().includes(q)),
  );

  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {/* ── Chosen, in order ─────────────────────────────────────────────── */}
      {selected.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          No designs selected yet. The section will not appear on the site until you add at least one.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {selected.map(({ id, bp }, i) => (
            <li key={id} className="rounded-lg border bg-card p-2">
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-muted">
                {bp?.cover ? (
                  <BlueprintCover cover={bp.cover} name={bp.name} stickerUrlFor={stickerUrlFor} />
                ) : (
                  <span className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] font-medium text-muted-foreground">
                    {bp ? 'No cover yet' : 'Unavailable'}
                  </span>
                )}
                <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-semibold tabular-nums text-primary-foreground">
                  {i + 1}
                </span>
              </div>
              <p className="mt-1.5 truncate text-[12px] font-medium" title={bp?.name ?? id}>
                {bp?.name ?? 'Design no longer available'}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <IconBtn label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Move later" disabled={i === selected.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn
                  label="Remove"
                  onClick={() => onChange(selectedIds.filter((s) => s !== id))}
                  className="ml-auto text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* ── Add ──────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="relative mb-3 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs…"
            aria-label="Search designs to add"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-[13px] outline-none focus:border-ring"
          />
        </div>

        {available.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-muted-foreground">
            {options.length === 0
              ? 'No active designs exist yet. Create one in Layouts → Blueprints.'
              : 'Every matching design is already selected.'}
          </p>
        ) : (
          <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
            {available.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onChange([...selectedIds, o.id])}
                  title={`${o.name} · ${o.categoryLabel} · ${o.pageCount} pages`}
                  className="group w-full rounded-md border bg-card p-1.5 text-left transition-all duration-150 hover:border-primary/50 hover:shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded bg-muted">
                    {o.cover ? (
                      <BlueprintCover cover={o.cover} name={o.name} stickerUrlFor={stickerUrlFor} />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] text-muted-foreground">
                        No cover
                      </span>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-primary/0 text-primary-foreground opacity-0 transition-all duration-150 group-hover:bg-primary/45 group-hover:opacity-100">
                      <Plus className="h-5 w-5" />
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] font-medium">{o.name}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </button>
  );
}
