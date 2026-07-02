'use client';

import { useMemo, useState } from 'react';
import { Search, Sparkles, Star, Clock, Check, X, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoverDesignFromConfig } from './_cover-render';
import { applyCoverTemplateToAlbum, coverCategoryLabel } from '@/lib/cover-templates/model';
import type { CoverConfig } from '@/lib/builder/cover';

/** Minimal shape the builder passes down (a slice of the catalog's CoverTemplateOption). */
export type BuilderCoverTemplate = {
  id: string;
  name: string;
  category: string;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isNew: boolean;
  config: CoverConfig;
  previewUrl: string | null;
};

/**
 * In-builder Cover Templates panel (Task 2). Browse / search / filter / preview / apply — Canva-style.
 *
 * Applying a template COPIES its CoverConfig into the album (deep clone via applyCoverTemplateToAlbum,
 * photoIds nulled) and hands it to the builder's existing `onApply` → `updateCover` → `saveCoverDesign`.
 * There is NO reference/link to the template and NO new rendering path: the copied config is an ordinary
 * cover the customer can fully edit afterwards. Thumbnails use the cached preview image when present and
 * fall back to a live render only otherwise (bounded by the active-catalog size).
 */
export default function CoverTemplatesPanel({
  templates,
  stickerUrlFor,
  hasExistingDesign,
  onApply,
}: {
  templates: BuilderCoverTemplate[];
  stickerUrlFor: (stickerId: string) => string | undefined;
  hasExistingDesign: boolean;
  onApply: (config: CoverConfig) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [preview, setPreview] = useState<BuilderCoverTemplate | null>(null);
  const [confirming, setConfirming] = useState<BuilderCoverTemplate | null>(null);

  const categories = useMemo(() => {
    const set = new Set(templates.map((t) => t.category));
    return ['all', ...Array.from(set)];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter(
      (t) => (category === 'all' || t.category === category) && (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)),
    );
  }, [templates, query, category]);

  // Merchandising shelves (only when browsing "all" with no query, so search stays flat + fast).
  const flat = category !== 'all' || query.trim() !== '';
  const shelves = useMemo(() => {
    if (flat) return [];
    const mk = (label: string, Icon: typeof Star, items: BuilderCoverTemplate[]) => ({ label, Icon, items });
    return [
      mk('Pinned', Pin, filtered.filter((t) => t.pinned)),
      mk('Featured', Star, filtered.filter((t) => t.featured && !t.pinned)),
      mk('Popular', Sparkles, filtered.filter((t) => t.popular && !t.featured && !t.pinned)),
      mk('Recently added', Clock, filtered.filter((t) => t.isNew && !t.popular && !t.featured && !t.pinned)),
    ].filter((s) => s.items.length > 0);
  }, [filtered, flat]);

  const apply = (t: BuilderCoverTemplate) => {
    if (hasExistingDesign) {
      setConfirming(t);
      return;
    }
    onApply(applyCoverTemplateToAlbum(t.config));
    setPreview(null);
  };

  if (templates.length === 0) {
    return <p className="p-3 text-center text-[11px] text-muted-foreground">No cover templates are available yet.</p>;
  }

  const Card = ({ t }: { t: BuilderCoverTemplate }) => (
    <button
      type="button"
      onClick={() => setPreview(t)}
      className="group overflow-hidden rounded-lg border bg-card text-left transition-all hover:ring-2 hover:ring-studio-bright"
      title={t.name}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
        {t.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.previewUrl} alt={t.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        ) : (
          <CoverDesignFromConfig config={t.config} title="Your Title" imageUrl={null} stickerUrlFor={stickerUrlFor} />
        )}
      </div>
      <span className="block truncate px-2 py-1 text-[11px] font-medium">{t.name}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search + category filter */}
      <div className="space-y-2 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                category === c ? 'bg-studio text-white' : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {c === 'all' ? 'All' : coverCategoryLabel(c)}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog — shelves when browsing, flat grid when searching/filtering */}
      <div className="ms-scroll min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {flat ? (
          filtered.length === 0 ? (
            <p className="p-3 text-center text-[11px] text-muted-foreground">No templates match.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((t) => (
                <Card key={t.id} t={t} />
              ))}
            </div>
          )
        ) : (
          <>
            {shelves.map((s) => (
              <section key={s.label}>
                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <s.Icon className="h-3 w-3" /> {s.label}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {s.items.map((t) => (
                    <Card key={t.id} t={t} />
                  ))}
                </div>
              </section>
            ))}
            <section>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">All templates</p>
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((t) => (
                  <Card key={t.id} t={t} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Preview modal — large preview + one-click apply */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-[3/4] w-full bg-muted">
              {preview.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.previewUrl} alt={preview.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <CoverDesignFromConfig config={preview.config} title="Your Title" imageUrl={null} stickerUrlFor={stickerUrlFor} />
              )}
            </div>
            <div className="space-y-3 p-4">
              <div>
                <p className="text-sm font-semibold">{preview.name}</p>
                <p className="text-[11px] text-muted-foreground">{coverCategoryLabel(preview.category)}</p>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Applying replaces your current cover with this design. Everything stays fully editable afterwards.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                  <X /> Cancel
                </Button>
                <Button size="sm" onClick={() => apply(preview)}>
                  <Check /> Apply template
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Replace confirmation (only when the album already has a custom cover) */}
      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirming(null)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Replace your current cover?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This overwrites your existing cover design with “{confirming.name}”. You can keep editing it, but the current
              design will be replaced.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Keep mine
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onApply(applyCoverTemplateToAlbum(confirming.config));
                  setConfirming(null);
                  setPreview(null);
                }}
              >
                <Check /> Replace
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
