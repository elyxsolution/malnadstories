'use client';

import { useState } from 'react';
import { Check, Expand, Ruler, ImageOff, Layers } from 'lucide-react';
import { photoCap } from '@/lib/builder/model';
import ProductPreview from './_product-preview';
import type { ProductOption } from '@/lib/products/catalog';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * Customer Album Product selection. Premium "buy a printed product" feel: a card per physical
 * product (cover preview, dimensions, description, starting price, preview button, badge) →
 * then the supported page counts for the chosen product. Everything is data-driven from the
 * catalog; the wizard owns the selected ids.
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
    <div className="space-y-8">
      {/* ── Product cards: 1 / 2 / 3 up ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const isSel = p.id === selectedProductId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectProduct(p.id)}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card text-left transition-all duration-200 ${
                isSel ? 'ring-2 ring-primary shadow-lg' : 'hover:-translate-y-0.5 hover:shadow-md'
              }`}
            >
              {/* Cover preview */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                {p.coverPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.coverPreviewUrl}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-7 w-7" />
                  </div>
                )}

                {p.isDefault && (
                  <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm">
                    Most popular
                  </span>
                )}
                {isSel && (
                  <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-md">
                    <Check className="h-4 w-4" />
                  </span>
                )}

                <span
                  role="button"
                  tabIndex={0}
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
                  className="absolute bottom-3 right-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                >
                  <Expand className="h-3.5 w-3.5" /> Open Sample Album
                </span>
              </div>

              {/* Body */}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">{p.name}</h3>
                  {p.startingPrice != null && (
                    <span className="text-sm text-muted-foreground">
                      from <span className="font-semibold tabular-nums text-foreground">{inr(p.startingPrice)}</span>
                    </span>
                  )}
                </div>
                <p className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                  <Ruler className="h-3.5 w-3.5" /> {p.widthCm} × {p.heightCm} cm
                </p>
                {p.description && <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{p.description}</p>}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Page-count selection for the chosen product ─────────── */}
      {selected && selected.pageCounts.length > 0 && (
        <div className="animate-fade-in space-y-3">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">Choose your page count</h3>
            <p className="text-sm text-muted-foreground">
              How much of the journey to keep — you can arrange photos freely while building.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {selected.prices.map((pr) => {
              const isSel = pageCount === pr.pageCount;
              return (
                <button
                  key={pr.pageCount}
                  type="button"
                  onClick={() => onSelectPageCount(pr.pageCount)}
                  className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-all duration-200 ${
                    isSel ? 'border-primary bg-primary/[0.04] ring-1 ring-primary' : 'hover:border-ring hover:bg-accent/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-2xl font-semibold tabular-nums text-foreground">{pr.pageCount}</span>
                    {isSel && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">pages</span>
                  <span className="mt-1 text-lg font-semibold tabular-nums text-foreground">{inr(pr.price)}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Layers className="h-3 w-3" /> up to {photoCap(pr.pageCount)} photos
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
