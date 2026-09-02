import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PublicHeader from '@/components/public-header';
import PublicFooter from '@/components/public-footer';
import Reveal from '@/components/public/reveal';
import { Button } from '@/components/ui/button';
import { Sprig } from '@/components/brand';
import { listPublished } from '@/lib/cms/public';

export const metadata = {
  title: 'About — Malnad Stories',
  description:
    'Why Malnad Stories exists: printed albums, hand-bound to order, made for the journeys people want to keep.',
};

export const revalidate = 300;

/**
 * ABOUT — the narrative page.
 *
 * ⚠️ EVERY FACTUAL CLAIM ON THIS PAGE IS ALREADY IN THE REPOSITORY. The company name, the
 * Bengaluru base, the Western Ghats framing, the archival-paper / linen-spine / hand-bound
 * description and the 24/36/48-page formats are all taken from the existing Home page, the
 * footer and the contact page. Nothing was invented: no founding date, no founder biography, no
 * headcount, no customer numbers, no awards, no production statistics. Where a real detail is
 * missing, the copy stays about the CRAFT rather than filling the gap with a plausible-sounding
 * fact.
 *
 * THE "LEGACY STORY" CMS CONTENT LIVES HERE NOW. It used to be the whole of `/stories`, which
 * Phase 1 turned into the design gallery. These are narrative pieces about journeys, so a
 * narrative page is where they belong — and it means the content an editor has already published
 * kept a home instead of being dropped.
 */
export default async function AboutPage() {
  const stories = await listPublished('legacy_story');
  const testimonials = await listPublished('testimonial');
  const quote = testimonials[0] ?? null;

  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <PublicHeader />

      <main className="flex-1">
        {/* ── Opening statement ───────────────────────────────────────────────
            One sentence, set large. An About page that opens with a feature grid has
            already told you it has nothing to say. */}
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-32">
            <Reveal className="max-w-4xl" distance="sm">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                <Sprig className="h-3.5 w-3.5" aria-hidden /> About
              </p>
              <h1 className="mt-6 text-balance font-display text-[2.75rem] font-normal leading-[1.05] tracking-tight text-primary sm:text-6xl lg:text-[4.25rem]">
                Photographs were meant to be held.
              </h1>
              <p className="mt-8 max-w-2xl text-pretty text-xl font-light leading-relaxed text-muted-foreground">
                Most journeys end up in a folder. Malnad Stories exists to bring a few of them back
                out — printed on archival paper, hand-bound with a linen spine, and made to sit on a
                shelf rather than a hard drive.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── The craft ───────────────────────────────────────────────────────
            Two columns of prose rather than three icon cards. The claims here are the
            ones the product already makes elsewhere on the site. */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[0.8fr_1fr]">
            <Reveal distance="sm">
              <h2 className="font-display text-3xl font-normal leading-tight tracking-tight text-primary sm:text-4xl">
                Made one at a time, in the Western Ghats.
              </h2>
            </Reveal>
            <Reveal delay={80} className="space-y-6 text-base font-light leading-relaxed text-muted-foreground">
              <p>
                Every album is printed and bound after it is ordered. Nothing sits in a warehouse
                waiting for a buyer, which is why each one can be a different size, a different
                length, and a completely different design.
              </p>
              <p>
                The books come in 24, 36 and 48 pages. Photographs are laid out across full spreads
                so a landscape can run the width of the open book, and the binding lies flat so
                nothing important disappears into the fold.
              </p>
              <p>
                We are based in Bengaluru, and the places that gave the studio its name — the coffee
                country and the green slopes of the Malnad — are still the journeys we see most
                often in the albums we make.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Pull quote (real, from the CMS) ─────────────────────────────── */}
        {quote?.content && (
          <section className="border-y border-border bg-secondary px-5 py-20 sm:px-8 lg:py-28">
            <Reveal as="figure" distance="none" className="mx-auto max-w-3xl text-center">
              <blockquote className="text-balance font-display text-[26px] italic leading-relaxed text-foreground sm:text-3xl">
                {quote.content}
              </blockquote>
              <figcaption className="mt-8 text-sm">
                <span className="block h-px w-12 mx-auto bg-gold/60" aria-hidden />
                <span className="mt-5 block font-semibold text-primary">{quote.title}</span>
                {typeof quote.metadata.location === 'string' && (
                  <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {quote.metadata.location}
                  </span>
                )}
              </figcaption>
            </Reveal>
          </section>
        )}

        {/* ── Journeys (CMS legacy_story, relocated from /stories) ─────────── */}
        {stories.length > 0 && (
          <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="journeys-heading">
            <Reveal distance="sm" className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Journeys</p>
              <h2
                id="journeys-heading"
                className="mt-3 font-display text-4xl font-normal tracking-tight text-primary"
              >
                The kinds of books people make
              </h2>
            </Reveal>

            <div className="mt-14 space-y-20">
              {stories.map((s, i) => {
                const subtitle = typeof s.metadata.subtitle === 'string' ? s.metadata.subtitle : null;
                // Alternate the image side so a run of journeys reads as a spread rather than a list.
                const flip = i % 2 === 1;
                return (
                  <Reveal
                    key={s.id}
                    as="article"
                    className="grid items-center gap-x-12 gap-y-6 lg:grid-cols-2"
                  >
                    {s.coverImage && (
                      <div className={`relative aspect-[4/3] w-full overflow-hidden bg-muted ${flip ? 'lg:order-2' : ''}`}>
                        {/* CMS-provided remote URL; `unoptimized` avoids next/image domain config,
                            matching how the previous /stories page rendered exactly these rows. */}
                        <Image
                          src={s.coverImage}
                          alt=""
                          fill
                          unoptimized
                          draggable={false}
                          className="object-cover"
                          sizes="(max-width: 1024px) 100vw, 50vw"
                        />
                      </div>
                    )}
                    <div className={flip ? 'lg:order-1' : ''}>
                      <h3 className="font-display text-3xl font-normal leading-tight tracking-tight text-primary">
                        {s.title}
                      </h3>
                      {subtitle && (
                        <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-gold">{subtitle}</p>
                      )}
                      {s.content && (
                        <p className="mt-5 text-base font-light leading-relaxed text-muted-foreground">
                          {s.content}
                        </p>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Closing CTA ─────────────────────────────────────────────────── */}
        <section className="px-5 pb-24 sm:px-8">
          <Reveal className="mx-auto max-w-5xl border-t border-border pt-16 text-center">
            <h2 className="mx-auto max-w-2xl text-balance font-display text-4xl font-normal leading-tight tracking-tight text-primary sm:text-5xl">
              Start with a design you love.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button render={<Link href="/stories" />} size="lg">
                Explore designs <ArrowRight />
              </Button>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-semibold text-primary transition-all duration-150 ease-glide hover:gap-2.5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Talk to us <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
