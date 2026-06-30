'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { StickerCategory } from '@/lib/stickers';

const CHECKER = 'repeating-conic-gradient(#eef1ee 0% 25%, #fff 0% 50%) 50% / 12px 12px';

/**
 * Stickers tab — pick a decorative sticker (admin-managed catalog) to place on the focused page
 * or the cover. Grouped by category with a quick search. Nothing is hardcoded: the catalog is
 * fetched from the DB (active stickers only).
 */
export default function StickersPanel({
  catalog,
  hasTarget,
  onAdd,
}: {
  catalog: StickerCategory[];
  hasTarget: boolean;
  onAdd: (stickerId: string) => void;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      catalog
        .map((c) => ({ ...c, stickers: query ? c.stickers.filter((s) => s.name.toLowerCase().includes(query)) : c.stickers }))
        .filter((c) => c.stickers.length > 0),
    [catalog, query],
  );

  return (
    <div className="ms-scroll flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Stickers</p>

      {catalog.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
          No stickers available yet.
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stickers…"
              className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
            />
          </div>

          {!hasTarget && (
            <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-4 text-center text-[11px] text-muted-foreground">
              Add a spread first to place a sticker.
            </p>
          )}

          {filtered.map((cat) => (
            <section key={cat.id}>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{cat.name}</p>
              <div className="grid grid-cols-4 gap-2">
                {cat.stickers.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!hasTarget}
                    onClick={() => onAdd(s.id)}
                    title={s.name}
                    style={{ background: CHECKER }}
                    className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-studio-bright/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.thumbUrl} alt={s.name} className="absolute inset-0 h-full w-full object-contain p-1.5" />
                  </button>
                ))}
              </div>
            </section>
          ))}

          {query && filtered.length === 0 && (
            <p className="text-center text-[11px] text-muted-foreground">No stickers match “{q}”.</p>
          )}
        </>
      )}
    </div>
  );
}
