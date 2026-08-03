'use client';

import { Calendar, Check, ImageIcon, Layers, MapPin, Ruler, Sparkles } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { photoCap } from '@/lib/builder/model';
import type { ProductOption } from '@/lib/products/catalog';
import type { CoverOption } from '@/lib/covers';
import ProductSelect from './_product-select';
import SmartTitleInput from './_smart-title-input';

/**
 * STEP 1 — ALBUM DETAILS.
 *
 * This is the old Format and Begin screens merged into a single page. The point of the
 * merge is not just "fewer clicks": Format and Begin were never independent decisions.
 * You cannot submit one without the other (the create payload requires product, page
 * count AND title together), and splitting them meant the customer chose a book before
 * seeing what it cost with a name on it.
 *
 * So it is laid out as a PRODUCT CONFIGURATOR, not as a form: the choices sit in the
 * main column, and a specification rail tracks them live — dimensions, capacity, price.
 * Nothing here is a "step". The three groups (the book, the cover, the story) are
 * ordinary sections with real headings.
 *
 * Purely presentational and fully controlled — the wizard owns every value, so the
 * album-creation payload is assembled in exactly one place.
 */

export type CoverTemplateOption = { id: string; name: string; previewUrl: string | null };

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function StepDetails({
  albumProducts,
  covers,
  coverTemplates,
  albumProductId,
  pageCount,
  coverId,
  designId,
  customCover,
  title,
  destination,
  fromDate,
  toDate,
  description,
  dateError,
  titleTooLong,
  titleMaxLength,
  onSelectProduct,
  onSelectPageCount,
  onPickArtwork,
  onPickDesign,
  onPickCustom,
  onTitleChange,
  onTitleLocation,
  onDestinationChange,
  onFromDateChange,
  onToDateChange,
  onDescriptionChange,
}: {
  albumProducts: ProductOption[];
  covers: CoverOption[];
  coverTemplates: CoverTemplateOption[];
  albumProductId: string;
  pageCount: number | null;
  coverId: string | null;
  designId: string | null;
  customCover: boolean;
  title: string;
  destination: string;
  fromDate: string;
  toDate: string;
  description: string;
  dateError: boolean;
  titleTooLong: boolean;
  titleMaxLength: number;
  onSelectProduct: (id: string) => void;
  onSelectPageCount: (n: number) => void;
  onPickArtwork: (id: string) => void;
  onPickDesign: (id: string) => void;
  onPickCustom: () => void;
  onTitleChange: (v: string) => void;
  onTitleLocation: (loc: string) => void;
  onDestinationChange: (v: string) => void;
  onFromDateChange: (v: string) => void;
  onToDateChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  const selectedProduct = albumProducts.find((p) => p.id === albumProductId) ?? null;
  const price = pageCount ? (selectedProduct?.prices.find((p) => p.pageCount === pageCount)?.price ?? null) : null;

  // ONE cover grid. These used to be three separately-labelled blocks (design templates,
  // legacy artwork, custom) even though the customer is making a single choice with
  // mutually-exclusive options. Merging them is the difference between "three decisions"
  // and one — the kind badge carries the distinction that the headings used to.
  const coverTiles = [
    ...coverTemplates.map((t) => ({
      kind: 'design' as const,
      id: t.id,
      name: t.name,
      url: t.previewUrl,
      selected: designId === t.id,
      badge: 'Editable design',
      onPick: () => onPickDesign(t.id),
    })),
    ...covers.map((c) => ({
      kind: 'artwork' as const,
      id: c.id,
      name: c.name,
      url: c.thumbUrl,
      selected: coverId === c.id,
      badge: 'Artwork',
      onPick: () => onPickArtwork(c.id),
    })),
  ];

  const selectedCoverName = designId
    ? (coverTemplates.find((t) => t.id === designId)?.name ?? 'Cover template')
    : coverId
      ? (covers.find((c) => c.id === coverId)?.name ?? 'Cover artwork')
      : customCover
        ? 'Custom (blank)'
        : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── MAIN COLUMN ────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-10">
        <header>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">
            Design your album.
          </h1>
          <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            Pick the book you want printed, choose a cover, and give it a name. Everything here can be
            changed later from inside the builder.
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

        {/* 2 · The cover */}
        <Section
          title="The cover"
          description="Start from a designed cover, a piece of artwork, or a blank page. Either way you can edit it in the builder."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {coverTiles.map((tile) => (
              <button
                key={`${tile.kind}:${tile.id}`}
                type="button"
                onClick={tile.onPick}
                aria-pressed={tile.selected}
                className={`group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] ${
                  tile.selected
                    ? 'border-primary ring-2 ring-primary'
                    : 'hover:-translate-y-0.5 hover:border-ring hover:shadow-md'
                }`}
              >
                <span className="relative block aspect-[3/4] w-full overflow-hidden bg-muted">
                  {tile.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.url}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-glide group-hover:scale-[1.03]"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                      <ImageIcon className="h-6 w-6" />
                    </span>
                  )}
                  {tile.selected && (
                    <span className="animate-scale-in absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block truncate text-[13px] font-medium leading-tight">{tile.name}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{tile.badge}</span>
                </span>
              </button>
            ))}

            {/* Blank cover — a peer option in the same grid, not a separate decision. */}
            <button
              type="button"
              onClick={onPickCustom}
              aria-pressed={customCover}
              className={`group relative flex flex-col overflow-hidden rounded-xl border border-dashed bg-card text-left transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] ${
                customCover
                  ? 'border-primary border-solid ring-2 ring-primary'
                  : 'hover:-translate-y-0.5 hover:border-ring hover:shadow-md'
              }`}
            >
              <span className="relative flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-secondary/40 to-background px-2 text-center">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">Start from scratch</span>
                {customCover && (
                  <span className="animate-scale-in absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </span>
              <span className="block px-2.5 py-2">
                <span className="block truncate text-[13px] font-medium leading-tight">Custom cover</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">Blank</span>
              </span>
            </button>
          </div>
        </Section>

        {/* 3 · The story. The title input is deliberately the one loud element on this page —
            it is what gets printed on the cover. Everything around it stays quiet. */}
        <Section title="Your story" description="The title is printed on the cover. Everything else is optional context you can add now or later.">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label
                htmlFor="title"
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Album title
              </Label>
              <SmartTitleInput
                id="title"
                value={title}
                onChange={onTitleChange}
                onSelectLocation={onTitleLocation}
                placeholder="Name your story…"
                maxLength={titleMaxLength}
              />
              {titleTooLong && (
                <p className="text-xs text-destructive">Titles are limited to {titleMaxLength} characters.</p>
              )}
            </div>

            <div className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Destination" htmlFor="destination" icon={<MapPin className="h-3.5 w-3.5 text-primary/70" />}>
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
              <img
                src={selectedProduct.coverPreviewUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                <ImageIcon className="h-7 w-7" />
              </span>
            )}
          </div>

          <div className="space-y-4 p-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Your specification
              </p>
              <h2 className="mt-1.5 truncate font-display text-xl font-semibold tracking-tight">
                {title.trim() || selectedProduct?.name || 'Untitled album'}
              </h2>
              {title.trim() && selectedProduct && (
                <p className="truncate text-[13px] text-muted-foreground">{selectedProduct.name}</p>
              )}
            </div>

            <dl className="space-y-2.5 border-t pt-4 text-[13px]">
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
              <Spec
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Cover"
                value={selectedCoverName ?? 'Not chosen'}
                muted={!selectedCoverName}
              />
            </dl>

            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-[13px] text-muted-foreground">Album price</span>
              <span className="font-display text-2xl font-semibold tabular-nums">
                {price != null ? inr(price) : '—'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Printing and delivery are calculated at checkout. Nothing is charged yet.
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
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  icon,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  icon?: React.ReactNode;
  required?: boolean;
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
        {!required && <span className="font-normal normal-case tracking-normal text-muted-foreground/60">· optional</span>}
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
      <dd className={`truncate text-right font-medium tabular-nums ${muted ? 'text-muted-foreground/60' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}
