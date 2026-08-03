'use client';

import { useState } from 'react';
import { Check, Expand, Ruler, ImageOff, Layers } from 'lucide-react';
import { photoCap } from '@/lib/builder/model';
import ProductPreview from './_product-preview';
import type { ProductOption } from '@/lib/products/catalog';

/**
 * Customer Album Product selection — a card per physical product, then the supported page
 * counts for the chosen one. Data-driven from the catalog; the wizard owns the selected ids.
 *
 * DENSITY. These cards were built to sell: a 4:3 hero, 16px padding, a description block, a
 * price. In onboarding they are a *picker* — the customer is choosing a size, not being
 * convinced — so the footprint is roughly a quarter smaller (3:2 hero, 12px padding, tighter
 * gaps, no description) and the grid goes four-up on wide screens, so more products fit
 * without scrolling. Everything that identifies a product survives: thumbnail, name,
 * dimensions, available page counts, selection state.
 *
 * NO PRICING. Onboarding creates an album; it does not sell one. `prices`/`pageCounts` still
 * drive which page counts exist — the money is simply never rendered. Checkout is untouched.
 *
 * There is no `disabled` mode. It existed for the four-step flow, where navigating Back into
 * an already-created album had to show a frozen copy of this screen. The two-step flow never
 * returns here after creation, so the state was unreachable.
 */
export default function ProductSelect({
  products,
  selectedProductId,
  pageCount,
  onSelectProduct,
  onSelectPageCount,
}: {
  products: ProductOption[];
  selectedProductId: string;
  pageCount: number | null;
  onSelectProduct: (id: string) => void;
  onSelectPageCount: (n: number) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const selected = products.find((p) => p.id === selectedProductId) ?? null;

  return (
    <div className="space-y-6">
      {/* ── Product cards: 2 / 3 / 4 up ──────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {products.map((p) => {
          const isSel = p.id === selectedProductId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProduct(p.id)}
              aria-pressed={isSel}
              className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] ${
                isSel ? 'border-primary shadow-md ring-2 ring-primary' : 'hover:-translate-y-0.5 hover:shadow-md'
              }`}
            >
              {/* Cover preview */}
              <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted">
                {p.coverPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.coverPreviewUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 ease-glide group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}

                {p.isDefault && !isSel && (
                  <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur-sm">
                    Most popular
                  </span>
                )}
                {isSel && (
                  <span className="animate-scale-in absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-md">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}

                {/* Sample-album lightbox. A nested control, so it stops propagation. */}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Open a sample ${p.name} album`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewId(p.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setPreviewId(p.id);
                    }
                  }}
                  className="absolute bottom-2 right-2 inline-flex cursor-pointer items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100"
                >
                  <Expand className="h-3 w-3" /> Sample
                </span>
              </div>

              {/* Body — identity only: name, dimensions, available page counts. */}
              <div className="flex flex-1 flex-col gap-1 p-3">
                <h3 className="truncate font-display text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                  {p.name}
                </h3>
                <p className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                  <Ruler className="h-3 w-3 flex-none" /> {p.widthCm} × {p.heightCm} cm
                </p>
                {p.pageCounts.length > 0 && (
                  <p className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                    <Layers className="h-3 w-3 flex-none" /> {p.pageCounts.join(' · ')} pages
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Page-count selection for the chosen product ─────────── */}
      {selected && selected.pageCounts.length > 0 && (
        <div className="animate-fade-in space-y-2.5">
          <div>
            <h3 className="font-display text-[15px] font-semibold tracking-tight text-foreground">How many pages?</h3>
            <p className="text-[13px] text-muted-foreground">
              This fixes the album&rsquo;s length and photo capacity — you arrange them freely while building.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {selected.pageCounts.map((n) => {
              const isSel = pageCount === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSelectPageCount(n)}
                  aria-pressed={isSel}
                  className={`flex flex-col gap-0.5 rounded-xl border p-3 text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] ${
                    isSel
                      ? 'border-primary bg-primary/[0.04] ring-1 ring-primary'
                      : 'hover:border-ring hover:bg-accent/40'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-display text-xl font-semibold tabular-nums text-foreground">{n}</span>
                    {isSel && <Check className="h-3.5 w-3.5 flex-none text-primary" />}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">pages</span>
                  <span className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    up to {photoCap(n)} photos
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {previewId && (
        <ProductPreview
          productId={previewId}
          onStartDesigning={() => {
            onSelectProduct(previewId);
            setPreviewId(null);
          }}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}
