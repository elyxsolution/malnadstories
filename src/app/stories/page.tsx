import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PublicHeader from '@/components/public-header';
import PublicFooter from '@/components/public-footer';
import Reveal from '@/components/public/reveal';
import BlueprintGallery from '@/components/public/blueprint-gallery';
import { Button } from '@/components/ui/button';
import { listPublicBlueprints, categoriesIn } from '@/lib/blueprints/public';

export const metadata = {
  title: 'Stories — Album designs to start from',
  description:
    'Browse the complete collection of Malnad Stories album designs. Each one is a finished book — cover, pages and rhythm — ready for your photographs.',
};

/**
 * ISR, matching the other public pages. The catalogue is global and slowly-changing, and the read
 * beneath this (`listActiveBlueprints`) is itself cached under `CACHE_TAGS.templatesActive` — so
 * an admin activating or editing a design busts that tag and the next render picks it up. The
 * 300s revalidate is the backstop, not the mechanism.
 */
export const revalidate = 300;

/**
 * STORIES — the design gallery, and the heart of public discovery.
 *
 * NOT A BLOG. This route previously listed CMS `legacy_story` rows; that content now lives on
 * /about, where a narrative belongs. "Stories" here means the stories a customer is about to
 * make, and the page's single job is to help them choose the book they will make it in.
 *
 * A SERVER COMPONENT that resolves the catalogue once. Only the filter bar hydrates — every cover
 * is rendered on the server from its stored config, so this page ships no image requests, no
 * presigned URLs and no per-design round trips.
 */
export default async function StoriesPage() {
  const { blueprints, stickerUrls } = await listPublicBlueprints();
  const categories = categoriesIn(blueprints);

  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <PublicHeader />

      <main className="flex-1">
        {/* ── Editorial masthead ──────────────────────────────────────────────
            Deliberately generous. The gallery beneath is dense with covers, so the
            page opens with air and one clear sentence rather than jumping into a grid. */}
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <Reveal className="max-w-3xl" distance="sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">The collection</p>
              <h1 className="mt-4 text-balance font-display text-5xl font-normal leading-[1.02] tracking-tight text-primary sm:text-6xl">
                Every story deserves the right book.
              </h1>
              <p className="mt-6 max-w-2xl text-pretty text-lg font-light leading-relaxed text-muted-foreground">
                Each design is a complete album — the cover, the page rhythm and the way photographs
                breathe across a spread, all composed in advance. Choose one, and your photographs
                fall into place.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Gallery ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 lg:py-16" aria-label="Album designs">
          {blueprints.length === 0 ? (
            /*
              AN HONEST EMPTY STATE. No skeleton pretending designs are loading, and — above all —
              no invented designs. If the catalogue is genuinely empty (or a read failed), the page
              says so calmly and offers the other way in.
            */
            <div className="border border-dashed border-border bg-card/40 px-6 py-28 text-center">
              <p className="font-display text-3xl font-normal text-primary">The collection is being prepared</p>
              <p className="mx-auto mt-3 max-w-md text-sm font-light leading-relaxed text-muted-foreground">
                New designs are being finished right now. In the meantime you can start a blank album
                and lay it out exactly as you like.
              </p>
              <Button render={<Link href="/albums/new" />} size="lg" className="mt-8">
                Start a blank album
              </Button>
            </div>
          ) : (
            <BlueprintGallery blueprints={blueprints} stickerUrls={stickerUrls} categories={categories} />
          )}
        </section>

        {/* ── Closing CTA ─────────────────────────────────────────────────── */}
        {blueprints.length > 0 && (
          <section className="px-5 pb-24 sm:px-8">
            <Reveal className="mx-auto max-w-5xl overflow-hidden rounded-sm bg-primary px-8 py-16 text-center text-primary-foreground sm:px-16">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-pale">
                Nothing quite right?
              </p>
              <h2 className="mx-auto mt-4 max-w-2xl text-balance font-display text-4xl font-normal leading-tight sm:text-5xl">
                Start from a blank book instead.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm font-light text-primary-foreground/75">
                Every design here is a starting point, not a constraint — and you can always begin
                with an empty album and compose it page by page.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button render={<Link href="/albums/new" />} variant="secondary" size="lg">
                  Start a blank album
                </Button>
                <Link
                  href="/about"
                  className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-gold-pale transition-all duration-150 ease-glide hover:gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-pale focus-visible:ring-offset-4 focus-visible:ring-offset-primary"
                >
                  How we make them <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </Reveal>
          </section>
        )}
      </main>

      <PublicFooter />
    </div>
  );
}
