import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import Reveal from '@/components/public/reveal';
import BlueprintTile from '@/components/public/blueprint-tile';
import type { PublicBlueprintSet } from '@/lib/blueprints/public';

/**
 * THE CURATED DESIGN SHELF — Home's design moment.
 *
 * A SHELF, NOT A GRID OF CARDS. The first design is given a wider, quieter column with its
 * description; the rest sit beside it at a smaller scale. That asymmetry is what makes the
 * section read as an editorial spread rather than a product listing, and it costs nothing: it is
 * the same `BlueprintTile` at two variants.
 *
 * SERVER COMPONENT. The only client code on this section is the `Reveal` wrapper.
 *
 * ⚠️ MOBILE: a plain vertical stack, not a horizontal carousel. A carousel here would fight the
 * page's own scroll for no benefit — there are only a handful of designs, and a swipe that
 * sometimes moves the shelf and sometimes moves the page is exactly the touch confusion this
 * phase was asked to avoid.
 */
export default function BlueprintShelf({
  eyebrow,
  heading,
  subheading,
  set,
  ctaHref,
  ctaLabel,
}: {
  eyebrow: string;
  heading: string;
  subheading?: string | null;
  set: PublicBlueprintSet;
  ctaHref: string;
  ctaLabel: string;
}) {
  const { blueprints, stickerUrls } = set;

  // NOTHING CURATED → NOTHING RENDERED. Not a placeholder, not a "coming soon" box, and above all
  // not a fallback selection scraped from the catalogue. An editor who has published no selection
  // gets no section, and the page reads perfectly well without it.
  if (blueprints.length === 0) return null;

  const [lead, ...rest] = blueprints;

  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="designs-heading">
      <Reveal className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
          <h2
            id="designs-heading"
            className="mt-3 text-balance font-display text-4xl font-normal leading-[1.05] tracking-tight text-primary sm:text-5xl"
          >
            {heading}
          </h2>
          {subheading && (
            <p className="mt-4 max-w-lg text-pretty text-lg font-light leading-relaxed text-muted-foreground">
              {subheading}
            </p>
          )}
        </div>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary transition-all duration-150 ease-glide hover:gap-2.5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          {ctaLabel} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Reveal>

      <div className="mt-14 grid gap-x-8 gap-y-14 lg:grid-cols-[1.15fr_1fr]">
        {/* The lead design, at full weight. */}
        <Reveal delay={60}>
          <BlueprintTile blueprint={lead} stickerUrls={stickerUrls} variant="featured" />
        </Reveal>

        {/* The supporting designs. Two-up from `sm`, so a phone never shows a cramped pair. */}
        {rest.length > 0 && (
          <Reveal delay={120} className="grid grid-cols-1 gap-x-6 gap-y-12 self-start sm:grid-cols-2">
            {rest.map((b) => (
              <BlueprintTile key={b.id} blueprint={b} stickerUrls={stickerUrls} variant="gallery" />
            ))}
          </Reveal>
        )}
      </div>
    </section>
  );
}
