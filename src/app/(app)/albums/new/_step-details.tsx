'use client';

import { ArrowRight, ImageIcon, Layers, Ruler } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { photoCap } from '@/lib/builder/model';
import type { ProductOption } from '@/lib/products/catalog';
import ProductSelect, { PageCountSelect } from './_product-select';

/**
 * STEP 1 — ALBUM DETAILS.
 *
 * The old Format and Begin screens merged into one page. The merge is not just "fewer
 * clicks": they were never independent decisions — the create payload requires product and
 * page count together, so neither could be submitted alone.
 *
 * It reads as a PRODUCT CONFIGURATOR rather than a form: THREE COLUMNS, one per question.
 * The book, then how long it is, then a specification rail tracking both live. The books
 * stack vertically inside their column and the page counts inside theirs, so each column is
 * a short list rather than a grid, and the whole decision fits one screen without scrolling.
 *
 * Three things are deliberately NOT here:
 *
 *   • THE COVER. Choosing a cover before seeing a single page is a decision made with no
 *     information. Every album now starts from the admin's default template (0052) and the
 *     customer changes it in the builder, where the album is actually in front of them and
 *     every cover — plus full custom design — is available.
 *   • THE PRICE. This flow creates an album; it does not sell one. Pricing lives at
 *     checkout, where it is computed server-side and is the point of the screen.
 *   • THE TRIP STORY — destination, travel dates and a few words. Same reasoning as the
 *     cover: they are things to write with the album in front of you, not gates in front of
 *     it. This screen is now only the two decisions that are FIXED at creation and cannot be
 *     changed later. The wizard still holds and submits those fields (see `_wizard.tsx`), so
 *     the create payload, the derived title and the server contract are untouched.
 *
 * Purely presentational and fully controlled — the wizard owns every value, so the
 * album-creation payload is assembled in exactly one place.
 */

export default function StepDetails({
  albumProducts,
  albumProductId,
  pageCount,
  canContinue,
  creating,
  onContinue,
  onSelectProduct,
  onSelectPageCount,
}: {
  albumProducts: ProductOption[];
  albumProductId: string;
  pageCount: number | null;
  /** The wizard's own gate — this component only reflects it, it never re-derives it. */
  canContinue: boolean;
  creating: boolean;
  onContinue: () => void;
  onSelectProduct: (id: string) => void;
  onSelectPageCount: (n: number) => void;
}) {
  const selectedProduct = albumProducts.find((p) => p.id === albumProductId) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="max-w-prose">
        <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight sm:text-[2.2rem]">
          Design your album.
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Pick the book you want printed and how long it should be. You&rsquo;ll choose the cover, the
          title, the layouts and everything else in the builder.
        </p>
      </header>

      {/*
        THREE COLUMNS at `lg`, one below it. The two choice columns share the available width
        and the specification rail keeps its fixed track, so the rail never squeezes the
        controls and the controls never squash the preview.
      */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_290px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_310px]">
        {/* ── 1 · THE BOOK ─────────────────────────────────────────────── */}
        <Column title="The book" description="A real, bound photo book. Size decides how many photographs it holds.">
          <ProductSelect
            products={albumProducts}
            selectedProductId={albumProductId}
            onSelectProduct={onSelectProduct}
          />
        </Column>

        {/* ── 2 · HOW MANY PAGES ───────────────────────────────────────── */}
        <Column
          title="How many pages?"
          description="This fixes the album’s length and photo capacity — you arrange them freely while building."
        >
          <PageCountSelect
            product={selectedProduct}
            pageCount={pageCount}
            onSelectPageCount={onSelectPageCount}
          />
        </Column>

        {/* ── 3 · SPECIFICATION RAIL ───────────────────────────────────── */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
            <div className="relative aspect-[4/3] w-full bg-muted">
              {selectedProduct?.coverPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedProduct.coverPreviewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                  <ImageIcon className="h-7 w-7" />
                </span>
              )}
            </div>

            <div className="space-y-3.5 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Your specification
                </p>
                {/*
                  The rail used to headline whatever the customer had typed into the title field.
                  With no name collected here it states the thing this panel is actually about —
                  the chosen book — and never guesses at a title: the album's name is derived
                  server-side after Continue, so any placeholder shown here would be a second,
                  disagreeing answer to a question the screen no longer asks.
                */}
                <h2 className="mt-1.5 truncate font-display text-lg font-semibold tracking-tight">
                  {selectedProduct?.name ?? 'Choose your book'}
                </h2>
              </div>

              <dl className="space-y-2 border-t pt-3.5 text-[13px]">
                <Spec
                  icon={<Ruler className="h-3.5 w-3.5" />}
                  label="Dimensions"
                  value={selectedProduct ? `${selectedProduct.widthCm} × ${selectedProduct.heightCm} cm` : '—'}
                />
                <Spec
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Pages"
                  value={pageCount ? `${pageCount}` : 'Not chosen'}
                  muted={!pageCount}
                />
                <Spec
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Photo capacity"
                  value={pageCount ? `Up to ${photoCap(pageCount)}` : '—'}
                  muted={!pageCount}
                />
              </dl>

              <p className="border-t pt-3.5 text-[11px] leading-relaxed text-muted-foreground">
                Your cover, layouts and page design all come next, in the builder.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/*
        THE COMMIT, WHERE THE DECISION IS. It used to sit in the bottom-right of a sticky footer,
        the far corner from the page counts that enable it — so the control you were waiting for
        was the one place you were not looking. Centred beneath the choices, it reads as the
        conclusion of them.

        Presentation only: `canContinue` and the click handler are the wizard's, unchanged, so the
        disabled rule and the album-creation call are exactly what they were.
      */}
      <div className="mt-10 flex justify-center">
        <Button
          size="lg"
          onClick={onContinue}
          disabled={!canContinue || creating}
          className="h-12 min-w-[240px] px-8 text-[15px]"
        >
          {creating ? <InlineLoader /> : null}
          {creating ? 'Creating…' : 'Continue'}
          {!creating && <ArrowRight />}
        </Button>
      </div>
    </div>
  );
}

/** One titled column of related controls. Headings, not chapters — this is one page. */
function Column({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3.5">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Spec({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <span className="text-muted-foreground/60">{icon}</span>
        {label}
      </dt>
      <dd
        className={`truncate text-right font-medium tabular-nums ${muted ? 'text-muted-foreground/60' : 'text-foreground'}`}
      >
        {value}
      </dd>
    </div>
  );
}
