import Link from 'next/link';
import { ArrowRight, Check, Quote, Upload, LayoutTemplate, BookOpen } from 'lucide-react';
import { listActiveProducts, type ProductOption } from '@/lib/products/catalog';
import { Button } from '@/components/ui/button';
import Book from '@/components/book';
import { Sprig } from '@/components/brand';
import PublicHeader from '@/components/public-header';
import PublicFooter from '@/components/public-footer';
import { listPublished } from '@/lib/cms/public';

export const metadata = {
  title: 'Malnad Stories — Travel photo albums, hand-bound to order',
  description:
    'Upload your travel photos, arrange them into beautiful pages, and we print and deliver a premium hardcover album across India.',
};

// Re-presign the product cover images periodically (they're short-lived) + refresh the catalogue.
export const revalidate = 300;

const inr = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

const STEPS = [
  {
    icon: Upload,
    title: 'Gather your photos',
    body: 'Upload straight from your phone or camera. Every image is privately stored and quietly prepared for print.',
  },
  {
    icon: LayoutTemplate,
    title: 'Lay out your story',
    body: 'Arrange single pages or panoramic spreads, or let the layout assistant compose them for you in seconds.',
  },
  {
    icon: BookOpen,
    title: 'We print & bind it',
    body: 'Once you order, your album is printed on archival paper, hand-bound with a linen spine, and shipped to your door.',
  },
];

const DESTINATIONS = [
  { name: 'Chikmagalur', sub: 'The land of coffee', note: 'Mist-wrapped estate paths and high hills.' },
  { name: 'Sakleshpur', sub: 'Valleys & green slopes', note: 'Historic railway bridges and forest silence.' },
  { name: 'Coorg', sub: 'Misty spice groves', note: 'Waterfalls and plantations in layflat spreads.' },
];

export default async function HomePage() {
  // Real Album Product catalogue for the teaser (0047) — active products are anon-SELECTable.
  let catalogue: ProductOption[] = [];
  try {
    catalogue = await listActiveProducts();
  } catch {
    catalogue = [];
  }

  const testimonials = await listPublished('testimonial');
  const lead = testimonials[0] ?? null;
  const faqs = (await listPublished('faq')).slice(0, 4);

  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <PublicHeader />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-b border-border/60">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_-10%,hsl(var(--accent)/0.6),transparent_70%)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div className="animate-rise max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sprig className="h-3.5 w-3.5 text-gold" />
                Premium printed albums · delivered across India
              </span>
              <h1 className="mt-6 text-balance font-display text-5xl font-normal leading-[0.98] tracking-tight text-primary sm:text-6xl">
                Turn your travels into a book worth keeping.
              </h1>
              <p className="mt-6 max-w-lg text-pretty text-lg font-light leading-relaxed text-muted-foreground">
                Upload your photos, arrange them into beautiful pages, and we’ll print and hand-bind a
                premium hardcover album — made to be held, gifted, and kept.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button render={<Link href="/signup" />} size="lg">
                  Create your album <ArrowRight />
                </Button>
                <Button render={<Link href="/pricing" />} variant="outline" size="lg">
                  See pricing
                </Button>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                Secure checkout · 24, 36 &amp; 48-page hardcovers · No app required
              </p>
            </div>

            {/* Bound-book motif */}
            <div className="group hidden justify-center lg:flex">
              <Book title="A Week in the Western Ghats" year="2026" size="lg" thickness={16} />
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">The process</p>
            <h2 className="mt-3 font-display text-4xl font-normal tracking-tight text-primary">
              Three steps to something you can hold
            </h2>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-3">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="bg-card p-8">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-sm bg-secondary text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="font-display text-3xl font-light text-gold/80">0{i + 1}</span>
                  </div>
                  <h3 className="mt-5 font-display text-xl font-medium text-primary">{s.title}</h3>
                  <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Destinations showcase ───────────────────────────────────────── */}
        <section className="border-y border-border/60 bg-secondary/40">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                  Chapters of the Western Ghats
                </p>
                <h2 className="mt-3 font-display text-4xl font-normal tracking-tight text-primary">
                  Made for the places you travel
                </h2>
              </div>
              <Link
                href="/destinations"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-all hover:gap-2.5"
              >
                All destinations <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {DESTINATIONS.map((d) => (
                <article key={d.name} className="flex flex-col border border-border bg-card p-6 shadow-xs">
                  <h3 className="select-none font-handwritten text-4xl leading-none text-gold">{d.name}</h3>
                  <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {d.sub}
                  </span>
                  <p className="mt-3 flex-1 text-sm font-light leading-relaxed text-muted-foreground">{d.note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing teaser (real catalogue) ─────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Choose your album</p>
              <h2 className="mt-3 font-display text-4xl font-normal tracking-tight text-primary">
                Real books, everything included
              </h2>
            </div>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-all hover:gap-2.5"
            >
              Full pricing <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {catalogue.length === 0 ? (
            <p className="mt-12 border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
              Our albums are being updated — please check back shortly.
            </p>
          ) : (
            <div className="mt-12 grid gap-6 sm:grid-cols-3">
              {catalogue.map((p) => {
                const featured = p.isDefault;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col overflow-hidden border transition-all duration-300 ${
                      featured
                        ? 'border-transparent bg-primary text-primary-foreground shadow-elevated'
                        : 'border-border bg-card shadow-xs hover:-translate-y-0.5 hover:shadow-card'
                    }`}
                  >
                    {p.coverPreviewUrl && (
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.coverPreviewUrl} alt={p.name} className="h-full w-full object-cover" />
                        {featured && (
                          <span className="absolute left-3 top-3 rounded-full bg-gold px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary shadow-sm">
                            Most popular
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-6">
                      <h3 className={`font-display text-2xl font-medium ${featured ? 'text-primary-foreground' : 'text-primary'}`}>{p.name}</h3>
                      <p className={`mt-1 text-xs tabular-nums ${featured ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {p.widthCm} × {p.heightCm} cm · {p.pageCounts.join(' / ')} pages
                      </p>
                      {p.description && (
                        <p className={`mt-3 text-sm leading-relaxed ${featured ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{p.description}</p>
                      )}
                      <p className="mt-5">
                        <span className={`text-xs ${featured ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>From </span>
                        <span className="font-display text-4xl tabular-nums">{p.startingPrice != null ? inr(p.startingPrice) : '—'}</span>
                      </p>
                      <Button render={<Link href="/signup" />} variant={featured ? 'secondary' : 'outline'} className="mt-6 w-full">
                        Create this album
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Testimonial ─────────────────────────────────────────────────── */}
        {lead?.content && (
          <section className="border-y border-border bg-secondary px-5 py-20 sm:px-8">
            <figure className="mx-auto max-w-2xl text-center">
              <Quote className="mx-auto h-8 w-8 text-gold" aria-hidden />
              <blockquote className="mt-6 text-balance font-display text-2xl italic leading-relaxed text-foreground sm:text-[28px]">
                {lead.content}
              </blockquote>
              <figcaption className="mt-6 text-sm">
                <span className="font-semibold text-primary">{lead.title}</span>
                {typeof lead.metadata.location === 'string' && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{lead.metadata.location}</span>
                )}
              </figcaption>
            </figure>
          </section>
        )}

        {/* ── FAQ teaser (real CMS) ───────────────────────────────────────── */}
        {faqs.length > 0 && (
          <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
            <h2 className="text-center font-display text-4xl font-normal tracking-tight text-primary">
              Questions, answered
            </h2>
            <dl className="mt-12 divide-y divide-border border-y border-border">
              {faqs.map((f) => (
                <div key={f.id} className="py-6">
                  <dt className="font-display text-lg leading-snug text-foreground">{f.title}</dt>
                  {f.content && (
                    <dd className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">{f.content}</dd>
                  )}
                </div>
              ))}
            </dl>
            <div className="mt-8 text-center">
              <Link
                href="/faq"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold transition-all hover:gap-2.5"
              >
                Read the full FAQ <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>
        )}

        {/* ── Final CTA band ──────────────────────────────────────────────── */}
        <section className="px-5 pb-20 sm:px-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-sm bg-primary px-8 py-16 text-center text-primary-foreground sm:px-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-pale">Your story is waiting</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance font-display text-4xl font-normal leading-tight sm:text-5xl">
              Every memory deserves paper.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm font-light text-primary-foreground/75">
              Start your first album today — there’s nothing to install, and you only pay when you order.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button render={<Link href="/signup" />} variant="secondary" size="lg">
                Create your album
              </Button>
              <span className="inline-flex items-center gap-2 text-xs text-primary-foreground/70">
                <Check className="h-4 w-4 text-gold-pale" /> Free to start · pay on order
              </span>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
