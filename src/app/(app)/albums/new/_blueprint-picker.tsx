'use client';

import { useMemo, useState } from 'react';
import { Search, X, Star, Sparkles, Pin, Clock, LayoutGrid, Eye, Check, Wand2, Loader2, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { blueprintMatch, type BlueprintMatchTone } from '@/lib/builder/blueprint';
import { categoryLabel } from '@/lib/templates/model';

export type PickerBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isNew: boolean;
  thumbUrl: string | null;
};

const MATCH_STYLE: Record<BlueprintMatchTone, string> = {
  best: 'bg-primary text-primary-foreground',
  great: 'bg-success/15 text-success ring-1 ring-success/25',
  good: 'bg-secondary text-secondary-foreground',
  few: 'bg-amber-500/12 text-amber-600 ring-1 ring-amber-500/20',
  over: 'bg-warning/12 text-warning ring-1 ring-warning/25',
};

/**
 * Premium blueprint browser (Steps 2 & 3). A full-screen picker over the ALREADY-loaded active
 * blueprints (no new API): category sidebar, search, merchandising shelves (Pinned/Featured/Popular/
 * Recently added), large hover-animated cards with a live fit badge, a Preview modal, and one-click
 * apply (Use / Use + auto place). Reuses blueprintMatch + categoryLabel; renders nothing new server-side.
 */
export default function BlueprintPicker({
  blueprints,
  uploaded,
  busy,
  onApply,
  onClose,
}: {
  blueprints: PickerBlueprint[];
  uploaded: number;
  busy: boolean;
  onApply: (id: string, autoPlace: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [preview, setPreview] = useState<PickerBlueprint | null>(null);

  const categories = useMemo(() => {
    const set = new Set(blueprints.map((b) => b.category));
    return ['all', ...Array.from(set)];
  }, [blueprints]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => blueprints.filter((b) => (cat === 'all' || b.category === cat) && (!q || b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q))),
    [blueprints, cat, q],
  );
  const flat = cat !== 'all' || q !== '';

  const shelves = useMemo(() => {
    if (flat) return [];
    const mk = (label: string, Icon: typeof Star, items: PickerBlueprint[]) => ({ label, Icon, items });
    return [
      mk('Pinned', Pin, filtered.filter((b) => b.pinned)),
      mk('Featured', Star, filtered.filter((b) => b.featured && !b.pinned)),
      mk('Popular', Sparkles, filtered.filter((b) => b.popular && !b.featured && !b.pinned)),
      mk('Recently added', Clock, filtered.filter((b) => b.isNew && !b.popular && !b.featured && !b.pinned)),
    ].filter((s) => s.items.length > 0);
  }, [filtered, flat]);

  const Card = ({ b }: { b: PickerBlueprint }) => {
    const m = blueprintMatch(uploaded, b.slotCount, b.recommendedPhotos);
    return (
      <div className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-all duration-200 ease-glide hover:-translate-y-1 hover:shadow-elevated">
        <button type="button" onClick={() => setPreview(b)} className="relative block aspect-[4/3] w-full overflow-hidden bg-muted" aria-label={`Preview ${b.name}`}>
          {b.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.thumbUrl} alt={b.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-center text-muted-foreground">
              <LayoutGrid className="h-7 w-7 opacity-40" />
            </span>
          )}
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${MATCH_STYLE[m.tone]}`}>{m.label}</span>
          <span className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-center gap-1 bg-gradient-to-t from-black/45 to-transparent py-3 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm"><Eye className="h-3.5 w-3.5" /> Preview</span>
          </span>
        </button>
        <div className="flex flex-1 flex-col p-3">
          <p className="truncate text-sm font-semibold" title={b.name}>{b.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{categoryLabel(b.category)} · {b.pageCount} pages · holds {b.slotCount}</p>
          <div className="mt-auto grid grid-cols-2 gap-1.5 pt-3">
            <Button size="sm" onClick={() => onApply(b.id, true)} disabled={busy || uploaded === 0} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Auto place
            </Button>
            <Button size="sm" variant="outline" onClick={() => onApply(b.id, false)} disabled={busy} className="w-full">Use</Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in fixed inset-0 z-[110] flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">Choose a template</h2>
          <p className="text-[12px] text-muted-foreground">{blueprints.length} designed for your album · {uploaded} photo{uploaded === 1 ? '' : 's'} ready</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Category sidebar */}
        <aside className="hidden w-52 flex-none border-r p-3 sm:block">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Categories</p>
          <nav className="space-y-0.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${cat === c ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}
              >
                {c === 'all' ? 'All templates' : categoryLabel(c)}
              </button>
            ))}
          </nav>
        </aside>

        {/* Catalog */}
        <main className="ms-scroll min-h-0 flex-1 overflow-y-auto p-5">
          <div className="relative mb-4 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
            />
          </div>

          {blueprints.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No templates match “{query}”.</p>
          ) : flat ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((b) => <Card key={b.id} b={b} />)}
            </div>
          ) : (
            <div className="space-y-8">
              {shelves.map((s) => (
                <section key={s.label}>
                  <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><s.Icon className="h-3.5 w-3.5" /> {s.label}</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {s.items.map((b) => <Card key={b.id} b={b} />)}
                  </div>
                </section>
              ))}
              <section>
                <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><LayoutGrid className="h-3.5 w-3.5" /> All templates</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filtered.map((b) => <Card key={b.id} b={b} />)}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Preview modal (Step 3) */}
      {preview && (
        <div className="animate-fade-in fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="animate-scale-in flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-elevated sm:flex-row" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-[4/3] w-full bg-muted sm:w-3/5">
              {preview.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.thumbUrl} alt={preview.name} className="absolute inset-0 h-full w-full object-contain" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground"><ImageOff className="h-8 w-8 opacity-40" /></span>
              )}
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-display text-xl font-semibold tracking-tight">{preview.name}</h3>
                  <p className="text-[12px] text-muted-foreground">{categoryLabel(preview.category)}</p>
                </div>
                <button type="button" onClick={() => setPreview(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              {preview.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{preview.description}</p>}
              {(() => {
                const m = blueprintMatch(uploaded, preview.slotCount, preview.recommendedPhotos);
                return <span className={`mt-3 inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${MATCH_STYLE[m.tone]}`}>{m.label}</span>;
              })()}
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { k: 'Pages', v: preview.pageCount },
                  { k: 'Capacity', v: preview.slotCount },
                  { k: 'Recommended', v: preview.recommendedPhotos },
                ].map((s) => (
                  <div key={s.k} className="rounded-xl border bg-card px-2 py-3">
                    <dd className="text-lg font-semibold tabular-nums">{s.v}</dd>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.k}</dt>
                  </div>
                ))}
              </dl>
              <div className="mt-auto flex flex-col gap-2 pt-5">
                <Button onClick={() => onApply(preview.id, true)} disabled={busy || uploaded === 0}>
                  {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} Use + auto place my {uploaded} photo{uploaded === 1 ? '' : 's'}
                </Button>
                <Button variant="outline" onClick={() => onApply(preview.id, false)} disabled={busy}>
                  <Check /> Use blueprint (place photos myself)
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed p-12 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><LayoutGrid className="h-6 w-6" /></div>
      <p className="mt-3 font-display text-lg font-semibold">No templates for this size yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Try Auto Create, or design your own from a blank album — you can still lay out every page yourself.</p>
    </div>
  );
}
