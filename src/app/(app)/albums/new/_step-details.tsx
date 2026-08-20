'use client';

import { Calendar, ImageIcon, Layers, MapPin, Ruler } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { photoCap } from '@/lib/builder/model';
import type { ProductOption } from '@/lib/products/catalog';
import ProductSelect from './_product-select';
import SmartTitleInput from './_smart-title-input';

/**
 * STEP 1 — ALBUM DETAILS.
 *
 * The old Format and Begin screens merged into one page. The merge is not just "fewer
 * clicks": they were never independent decisions — the create payload requires product,
 * page count AND title together, so neither could be submitted alone.
 *
 * It reads as a PRODUCT CONFIGURATOR rather than a form: choices in the main column, a
 * specification rail tracking them live. Two things are deliberately NOT here:
 *
 *   • THE COVER. Choosing a cover before seeing a single page is a decision made with no
 *     information. Every album now starts from the admin's default template (0052) and the
 *     customer changes it in the builder, where the album is actually in front of them and
 *     every cover — plus full custom design — is available.
 *   • THE PRICE. This flow creates an album; it does not sell one. Pricing lives at
 *     checkout, where it is computed server-side and is the point of the screen.
 *
 * Purely presentational and fully controlled — the wizard owns every value, so the
 * album-creation payload is assembled in exactly one place.
 */

export default function StepDetails({
  albumProducts,
  albumProductId,
  pageCount,
  destination,
  fromDate,
  toDate,
  description,
  dateError,
  onSelectProduct,
  onSelectPageCount,
  onDestinationChange,
  onFromDateChange,
  onToDateChange,
  onDescriptionChange,
}: {
  albumProducts: ProductOption[];
  albumProductId: string;
  pageCount: number | null;
  destination: string;
  fromDate: string;
  toDate: string;
  description: string;
  dateError: boolean;
  onSelectProduct: (id: string) => void;
  onSelectPageCount: (n: number) => void;
  onDestinationChange: (v: string) => void;
  onFromDateChange: (v: string) => void;
  onToDateChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  const selectedProduct = albumProducts.find((p) => p.id === albumProductId) ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── MAIN COLUMN ────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-9">
        <header>
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight sm:text-[2.2rem]">
            Design your album.
          </h1>
          <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
            Pick the book you want printed. You&rsquo;ll choose the cover, the title, the layouts and
            everything else in the builder.
          </p>
        </header>

        {/* 1 · The book */}
        <Section title="The book" description="A real, bound photo book. Size decides how many photographs it holds.">
          <ProductSelect
            products={albumProducts}
            selectedProductId={albumProductId}
            pageCount={pageCount}
            onSelectProduct={onSelectProduct}
            onSelectPageCount={onSelectPageCount}
          />
        </Section>

        {/* 2 · The story. Where and when, in the customer's own words — no name is asked for
            (Phase 5): the album is titled from these details and renamed in the builder, on the
            cover itself, where the words are actually in front of them. */}
        <Section
          title="Your story"
          description="Where you went and when. All of it is optional, and everything — including the title on the cover — can be changed later in the builder."
        >
          <div className="space-y-5">
            <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Destination"
                  htmlFor="destination"
                  icon={<MapPin className="h-3.5 w-3.5 text-primary/70" />}
                >
                  <SmartTitleInput
                    id="destination"
                    value={destination}
                    onChange={onDestinationChange}
                    onSelectLocation={onDestinationChange}
                    placeholder="Where did you go?"
                    maxLength={120}
                    inputClassName="font-ui text-[15px] font-normal leading-normal sm:text-[15px]"
                  />
                </Field>

                <Field label="Travel dates" icon={<Calendar className="h-3.5 w-3.5 text-primary/70" />}>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Travel start date"
                      type="date"
                      value={fromDate}
                      max={toDate || undefined}
                      onChange={(e) => onFromDateChange(e.target.value)}
                    />
                    <Input
                      aria-label="Travel end date"
                      type="date"
                      value={toDate}
                      min={fromDate || undefined}
                      onChange={(e) => onToDateChange(e.target.value)}
                    />
                  </div>
                  {dateError && (
                    <p className="text-xs text-destructive">The first date must be on or before the second.</p>
                  )}
                </Field>
              </div>

              <Field label="A few words" htmlFor="description">
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="What made this trip worth keeping?"
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 font-display text-lg italic text-foreground shadow-xs outline-none transition-shadow placeholder:not-italic placeholder:text-[15px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </Field>
            </div>
          </div>
        </Section>
      </div>

      {/* ── SPECIFICATION RAIL ─────────────────────────────────────────── */}
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
              {destination.trim() && (
                <p className="truncate text-[12px] text-muted-foreground">{destination.trim()}</p>
              )}
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
  );
}

/** A titled group of related controls. Headings, not chapters — this is one page. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3.5">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-0.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  icon,
  children,
}: {
  label: string;
  htmlFor?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
      >
        {icon}
        {label}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">· optional</span>
      </Label>
      {children}
    </div>
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
