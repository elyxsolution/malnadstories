import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import BlueprintCover from '@/components/blueprint-cover';
import { designHref } from '@/components/public/blueprint-tile';
import type { PublicBlueprintSet } from '@/lib/blueprints/public';

/**
 * A CURATED SHELF OF DESIGNS, ON THE DASHBOARD — the third thing a customer can do here.
 *
 * The dashboard answers two questions well ("carry on with this" and "start something new") and
 * has never answered the third: *what could it look like?* This is that answer, kept deliberately
 * small — a handful of designs an administrator chose, not a catalogue. `/stories` remains the
 * full gallery, and the shelf's own link says so.
 *
 * ── NOTHING HERE DECIDES WHAT IS FEATURED ──────────────────────────────────────────────────
 * The designs arrive already resolved. The page loads a CMS placement by slug, the CMS row names
 * the design ids, and `resolveBlueprintRefs` turns them into designs IN THE EDITOR'S ORDER. There
 * is no id in this file, no "first three from the catalogue", and no sort — reordering the list
 * here would silently overrule the person who arranged it.
 *
 * ── NO FABRICATION ─────────────────────────────────────────────────────────────────────────
 * If nothing is configured, the page renders nothing at all: this component is not even mounted.
 * A dashboard with no shelf is a correct dashboard; a dashboard showing invented designs is not.
 *
 * ── THE COVER IS THE DESIGN ────────────────────────────────────────────────────────────────
 * `BlueprintCover` draws the blueprint's own FRONT COVER through `CoverDesignFromConfig` — the
 * same renderer the builder, the preview and the printed cover use — so a design looks here
 * exactly as it will bound. The retired interior-spread montage is not used, and a design with
 * no cover of its own falls back to the public tile's typographic stand-in rather than to an
 * invented one.
 *
 * ── ONE DESTINATION, SHARED WITH THE PUBLIC SITE ───────────────────────────────────────────
 * `designHref` is the same builder the Stories gallery and the Home shelf use, so "Use design"
 * means one thing everywhere: `/albums/new?design=<id>`. That route re-resolves the id against
 * the active catalog server-side, and `createAlbumDraft` and `applyBlueprintToAlbum` each
 * re-validate it again before it can touch an album. The id travels; nothing else does.
 *
 * A SERVER COMPONENT with no client code at all — the hover treatment is CSS.
 */
export default function DesignShelf({
  heading,
  subheading,
  set,
}: {
  /** Editorial copy from the CMS row, with the page's own defaults behind it. */
  heading: string | null;
  subheading: string | null;
  set: PublicBlueprintSet;
}) {
  const { blueprints, stickerUrls } = set;
  if (blueprints.length === 0) return null;

  const stickerUrlFor = (id: string) => stickerUrls[id];

  return (
    <section className="mt-12" aria-labelledby="dashboard-designs-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2
            id="dashboard-designs-heading"
            className="font-display text-3xl font-medium tracking-tight text-primary"
          >
            {heading ?? 'Start from a design'}
          </h2>
          <p className="mt-1.5 max-w-prose text-sm font-light text-muted-foreground">
            {subheading ?? 'A few of our favourites — the cover, the page rhythm and the spreads, composed in advance.'}
          </p>
        </div>
        {/* The full gallery is elsewhere, and this says so rather than growing into it. */}
        <Link
          href="/stories"
          className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold text-primary transition-all duration-150 ease-glide hover:gap-2.5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          All designs <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {/*
        A GRID, NOT A CAROUSEL. Below `sm` it is a single column and the page scrolls as it always
        has — no horizontal scroller, no scroll-snap, and above all no pointer handler that could
        swallow a vertical swipe begun on a cover.
      */}
      <ul className="mt-7 grid grid-cols-1 gap-x-7 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {blueprints.map((b) => (
          <li key={b.id}>
            <article className="group/design">
              {/*
                TWO SIBLING LINKS, NEVER NESTED — the cover and the action are separate anchors
                to the same place, so neither wraps the other and both are reachable by keyboard.
                `draggable={false}` is the one thing that can steal a press on a cover, and the
                only touch-related property set anywhere here.
              */}
              <Link
                href={designHref(b.id)}
                draggable={false}
                tabIndex={-1}
                aria-hidden
                className="block rounded-sm focus-visible:outline-none"
              >
                <div className="ms-lift relative aspect-[3/4] w-full overflow-hidden bg-secondary shadow-[0_1px_2px_rgb(16_24_20/0.06),0_14px_32px_-22px_rgb(16_24_20/0.45)] group-hover/design:shadow-[0_2px_6px_rgb(16_24_20/0.08),0_22px_44px_-22px_rgb(16_24_20/0.55)]">
                  {b.cover ? (
                    <BlueprintCover cover={b.cover} name={b.name} stickerUrlFor={stickerUrlFor} />
                  ) : (
                    /* The public tile's own stand-in for a design that has no cover yet — never
                       a placeholder icon, and never the retired interior montage. */
                    <div className="flex h-full w-full flex-col items-center justify-center bg-primary px-5 text-center text-primary-foreground">
                      <span className="font-display text-lg leading-tight">{b.name}</span>
                      <span className="mt-2.5 block h-px w-8 bg-gold-pale/60" />
                      <span className="mt-2.5 text-[10px] uppercase tracking-[0.2em] text-primary-foreground/60">
                        {b.categoryLabel}
                      </span>
                    </div>
                  )}
                </div>
              </Link>

              <div className="mt-3.5">
                <h3 className="font-display text-[17px] font-normal leading-snug tracking-tight text-primary">
                  {b.name}
                </h3>
                {/* Only what the catalogue already knows. No invented marketing line. */}
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {b.categoryLabel}
                  <span aria-hidden> · </span>
                  <span className="tabular-nums">{b.pageCount}</span> pages
                </p>
                <Link
                  href={designHref(b.id)}
                  aria-label={`Use the ${b.name} design`}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold text-primary transition-all duration-150 ease-glide hover:gap-2.5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Use design
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
