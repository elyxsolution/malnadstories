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
  onSelectProduct,
}: {
  products: ProductOption[];
  selectedProductId: string;
  onSelectProduct: (id: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* ── Product cards, VERTICALLY STACKED ─────────────────────
          One column, one card per book, so the three books read as a list to work down
          rather than a grid to scan across — and so page counts can sit beside them in
          their own column instead of underneath. Each card is a row: thumbnail, then
          identity. Selection state, the sample lightbox and every datum are unchanged. */}
      {products.map((p) => {
        const isSel = p.id === selectedProductId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectProduct(p.id)}
            aria-pressed={isSel}
            className={`group relative flex w-full items-stretch gap-3 overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99] ${
              isSel ? 'border-primary shadow-md ring-2 ring-primary' : 'hover:-translate-y-0.5 hover:shadow-md'
            }`}
          >
            {/* Cover preview */}
            <div className="relative aspect-[3/2] w-[104px] flex-none overflow-hidden bg-muted sm:w-[120px]">
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
                className="absolute bottom-1.5 right-1.5 inline-flex cursor-pointer items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover:opacity-100"
              >
                <Expand className="h-3 w-3" /> Sample
              </span>
            </div>

            {/* Body — identity only: name, dimensions, available page counts. */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-3 pr-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate font-display text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                  {p.name}
                </h3>
                {isSel ? (
                  <span className="animate-scale-in grid h-5 w-5 flex-none place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                ) : (
                  p.isDefault && (
                    <span className="flex-none rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground">
                      Popular
                    </span>
                  )
                )}
              </div>
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

/**
 * Page-count selection for the chosen product.
 *
 * Extracted from `ProductSelect` (it was rendered directly underneath the product grid) so it
 * can occupy its own column beside the books. Same options, same source of truth — the
 * catalog's `pageCounts` for the selected product — same `aria-pressed` selection state, and
 * the same single `onSelectPageCount` callback the wizard already owned. Nothing about which
 * counts exist, or what selecting one does, changed.
 */
export function PageCountSelect({
  product,
  pageCount,
  onSelectPageCount,
}: {
  product: ProductOption | null;
  pageCount: number | null;
  onSelectPageCount: (n: number) => void;
}) {
  if (!product || product.pageCounts.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] leading-relaxed text-muted-foreground">
        Choose a book first — its available page counts appear here.
      </p>
    );
  }

  return (
    <div className="animate-fade-in space-y-3">
      {product.pageCounts.map((n) => {
        const isSel = pageCount === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onSelectPageCount(n)}
            aria-pressed={isSel}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99] ${
              isSel ? 'border-primary bg-primary/[0.04] ring-1 ring-primary' : 'hover:border-ring hover:bg-accent/40'
            }`}
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-display text-xl font-semibold tabular-nums text-foreground">{n}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">pages</span>
            </span>
            <span className="flex flex-none items-center gap-2">
              <span className="text-[11px] tabular-nums text-muted-foreground">up to {photoCap(n)} photos</span>
              {isSel && <Check className="h-3.5 w-3.5 flex-none text-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
