'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import BlueprintTile from '@/components/public/blueprint-tile';
import type { PublicBlueprint } from '@/lib/blueprints/public';

/**
 * THE DESIGN GALLERY — discovery for the whole active catalogue.
 *
 * THE FILTERING RULE IS THE ONE THE BUILDER'S PICKER ALREADY USES. `_blueprint-picker.tsx`
 * narrows by category and matches a query against name + category; this does the same, so a
 * design a customer finds here is found the same way inside the product. What is deliberately NOT
 * shared is the PRESENTATION: the picker is a dense full-screen modal for someone mid-task, this
 * is an editorial gallery for someone browsing. Extracting a common component would have forced
 * one of those two to compromise.
 *
 * WHY THIS IS A CLIENT COMPONENT AND THE TILES ARE NOT. Only the controls need state. The tiles
 * themselves are Server Components rendered by the page and passed in as `children`-shaped data —
 * no, more precisely: they are rendered HERE from plain data, and `BlueprintTile` has no client
 * code of its own, so the hydration cost is the filter bar, not the covers.
 *
 * NO PAGINATION, DELIBERATELY. The catalogue is a curated set of designs, not an infinite feed;
 * a "load more" button that almost never appears is worse than a page that simply shows the
 * collection. If the catalogue grows past a few dozen, revisit — the filter bar is already the
 * mechanism that makes a large set navigable.
 */
export default function BlueprintGallery({
  blueprints,
  stickerUrls,
  categories,
}: {
  blueprints: PublicBlueprint[];
  stickerUrls: Record<string, string>;
  categories: { key: string; label: string }[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      blueprints.filter(
        (b) =>
          (category === 'all' || b.category === category) &&
          (!q || b.name.toLowerCase().includes(q) || b.categoryLabel.toLowerCase().includes(q)),
      ),
    [blueprints, category, q],
  );

  // One filter row is pointless when there is only one category to choose. The control disappears
  // rather than showing "All | Travel" — a filter that cannot filter is chrome.
  const showCategories = categories.length > 1;

  return (
    <>
      <div className="flex flex-col gap-5 border-y border-border/60 py-5 md:flex-row md:items-center md:justify-between">
        {showCategories && (
          <div
            role="group"
            aria-label="Filter designs by category"
            // `-mx-5 px-5` lets the row bleed to the screen edge on a phone so the last chip is
            // reachable; `overflow-x-auto` scrolls it horizontally WITHOUT touching the page's
            // vertical scroll, because only this element is scrollable and no gesture is captured.
            className="ms-scroll -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
          >
            {[{ key: 'all', label: 'All designs' }, ...categories].map((c) => {
              const active = category === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  aria-pressed={active}
                  className={`flex-none rounded-full border px-4 py-2 text-[13px] font-medium transition-all duration-150 ease-glide active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs…"
            aria-label="Search designs by name"
            className="h-11 w-full rounded-full border border-border bg-card pl-9 pr-9 text-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground" aria-live="polite">
        <span className="tabular-nums">{filtered.length}</span> {filtered.length === 1 ? 'design' : 'designs'}
      </p>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border bg-card/40 px-6 py-24 text-center">
          <p className="font-display text-2xl font-normal text-primary">Nothing matches that yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
            Try a different category, or clear the search to see the whole collection.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategory('all');
            }}
            className="mt-6 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-primary transition-all duration-150 ease-glide hover:border-primary/40 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Show all designs
          </button>
        </div>
      ) : (
        /*
          AN EDITORIAL RHYTHM, NOT A METRONOME — created by VERTICAL OFFSET, not by width.
          The middle column drops by a fixed amount on wide screens, so the covers sit in a
          gently staggered arrangement instead of a rigid three-across ledger.

          WIDTH IS DELIBERATELY UNIFORM. The obvious alternative — letting some designs span two
          columns — would double a 3:4 cover's width and therefore its HEIGHT, producing a tile
          two-and-a-half times taller than its neighbours and a page that scrolls past one book at
          a time. Offsetting keeps every cover at the same scale and the same aspect, which is
          also what keeps the comparison between designs honest.

          The offset is `lg:` only: at one and two columns it would just look like a mistake.
          `items-start` stops a row stretching every tile to the tallest caption.
        */
        <div className="mt-10 grid grid-cols-1 items-start gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10">
          {filtered.map((b, i) => (
            <div key={b.id} className={i % 3 === 1 ? 'lg:mt-20' : undefined}>
              <BlueprintTile blueprint={b} stickerUrls={stickerUrls} variant="gallery" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
