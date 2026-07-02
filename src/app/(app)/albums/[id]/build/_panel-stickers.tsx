'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Clock } from 'lucide-react';
import type { StickerCategory } from '@/lib/stickers';

const CHECKER = 'repeating-conic-gradient(#eef1ee 0% 25%, #fff 0% 50%) 50% / 12px 12px';
const RECENT_KEY = 'ms:stickers:recent';
const RECENT_MAX = 12;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Stickers tab — pick a decorative sticker (admin-managed catalog) to place on the focused page
 * or the cover. Search + category chips + a "Recently used" shelf (persisted in localStorage).
 * Nothing is hardcoded: the catalog is fetched from the DB (active stickers only). Thumbnails
 * lazy-load over a checker placeholder so a large catalog stays smooth.
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
  const [catFilter, setCatFilter] = useState<string>('all');
  const [recent, setRecent] = useState<string[]>([]);
  const query = q.trim().toLowerCase();

  // Hydrate recents on the client only (avoids SSR mismatch).
  useEffect(() => setRecent(readRecent()), []);

  // Flat id → option lookup for resolving the recents shelf.
  const byId = useMemo(() => {
    const m = new Map<string, StickerCategory['stickers'][number]>();
    for (const c of catalog) for (const s of c.stickers) m.set(s.id, s);
    return m;
  }, [catalog]);

  const handleAdd = (id: string) => {
    onAdd(id);
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota/availability */
      }
      return next;
    });
  };

  const filtered = useMemo(
    () =>
      catalog
        .filter((c) => catFilter === 'all' || c.id === catFilter)
        .map((c) => ({ ...c, stickers: query ? c.stickers.filter((s) => s.name.toLowerCase().includes(query)) : c.stickers }))
        .filter((c) => c.stickers.length > 0),
    [catalog, query, catFilter],
  );

  const recentOptions = useMemo(
    () => recent.map((id) => byId.get(id)).filter((s): s is StickerCategory['stickers'][number] => !!s),
    [recent, byId],
  );
  const showRecent = catFilter === 'all' && !query && recentOptions.length > 0;

  const Thumb = ({ id, name, url }: { id: string; name: string; url: string }) => (
    <button
      type="button"
      disabled={!hasTarget}
      onClick={() => handleAdd(id)}
      title={name}
      style={{ background: CHECKER }}
      className="group relative aspect-square overflow-hidden rounded-lg ring-1 ring-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card hover:ring-studio-bright/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" className="absolute inset-0 h-full w-full object-contain p-1.5" />
    </button>
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

          {/* Category chips */}
          <div className="flex flex-wrap gap-1">
            <Chip active={catFilter === 'all'} onClick={() => setCatFilter('all')}>All</Chip>
            {catalog.map((c) => (
              <Chip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>

          {!hasTarget && (
            <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-4 text-center text-[11px] text-muted-foreground">
              Add a spread first to place a sticker.
            </p>
          )}

          {showRecent && (
            <section>
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" /> Recently used
              </p>
              <div className="grid grid-cols-4 gap-2">
                {recentOptions.map((s) => (
                  <Thumb key={`recent-${s.id}`} id={s.id} name={s.name} url={s.thumbUrl} />
                ))}
              </div>
            </section>
          )}

          {filtered.map((cat) => (
            <section key={cat.id}>
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{cat.name}</p>
              <div className="grid grid-cols-4 gap-2">
                {cat.stickers.map((s) => (
                  <Thumb key={s.id} id={s.id} name={s.name} url={s.thumbUrl} />
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? 'bg-studio text-studio-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
