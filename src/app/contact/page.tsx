import Link from 'next/link';
import { Mail, Phone, MapPin, LifeBuoy } from 'lucide-react';
import PublicHeader from '@/components/public-header';
import PublicFooter from '@/components/public-footer';
import Reveal from '@/components/public/reveal';
import FaqAccordion, { type FaqItem } from '@/components/public/faq-accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listPublished } from '@/lib/cms/public';

export const metadata = {
  title: 'Contact & FAQ — Malnad Stories',
  description: 'Get in touch with the Malnad Stories team, and answers to the questions we are asked most.',
};

export const revalidate = 300;

/** Unchanged from the previous contact page — the same real addresses and hours. */
const CONTACTS = [
  {
    icon: Mail,
    title: 'Email support',
    note: 'We reply within 24 hours.',
    value: 'support@malnadstories.com',
    href: 'mailto:support@malnadstories.com',
  },
  {
    icon: Phone,
    title: 'Call us',
    note: 'Mon–Sat, 9:00 AM – 6:00 PM IST.',
    value: '+91 80 4567 8901',
    href: 'tel:+918045678901',
  },
];

/**
 * ⚠️ PLACEHOLDER FAQ CONTENT — TEMPORARY, AND DELIBERATELY CLAIM-FREE.
 *
 * These are stand-ins so the page has real structure to test and design against. They answer only
 * questions the repository can already substantiate: the album formats (24/36/48 pages), that
 * designs are starting points that can be changed, that printing happens after ordering, and that
 * signed-in customers raise support tickets. They state NO price, NO delivery window, NO refund or
 * shipping policy and NO production guarantee, because this product has not published any.
 *
 * REPLACE THEM WITH CMS CONTENT. The CMS already has a `faq` content type with a `category` field
 * and the public reader already fetches it — the block below prefers published CMS rows and falls
 * back to these only while none exist. Publishing real FAQs in the admin retires this array with
 * no code change.
 */
const PLACEHOLDER_FAQ: FaqItem[] = [
  {
    question: 'How does Malnad Stories work?',
    answer:
      'You choose a design, upload your photographs, and arrange them across the pages. When you are happy with it, you order — and the album is printed and hand-bound before it ships to you.',
  },
  {
    question: 'How do I choose a design?',
    answer:
      'Browse the collection on the Stories page. Each design is a complete album: a cover, a page count, and a layout rhythm already composed. Pick the one that suits your journey and your number of photographs.',
  },
  {
    question: 'Can I change the design later?',
    answer:
      'Yes. A design is a starting point, not a constraint. Once your album is open in the builder you can change the cover, rearrange pages, swap photographs and adjust the layout as much as you like, right up until you order.',
  },
  {
    question: 'How much can one album hold?',
    answer:
      'Albums come in 24, 36 and 48 pages. Each design tells you how many photographs it is composed for, and you can always add or remove pages within the size you chose.',
  },
  {
    question: 'Can I customise the cover?',
    answer:
      'The cover is part of the design, and it is fully editable — the title, the colours, the typography, a photograph of your own, and decorative elements are all yours to change.',
  },
  {
    question: 'How do I get help with an order?',
    answer:
      'Email us at support@malnadstories.com, or — if you already have an account — open a support ticket from your dashboard so the conversation is attached to your specific order and album.',
  },
];

export default async function ContactPage() {
  /*
   * PREFER REAL CMS CONTENT. If an editor has published FAQ rows, those are shown; the
   * placeholders above exist only to keep the page complete until then.
   *
   * ⚠️ `listPublished('faq')` has a pre-existing fabricated fallback (see lib/cms/public.ts): on a
   * query error it returns two invented FAQ entries rather than an empty list. That behaviour is
   * out of Phase 1's scope to change and is recorded as a follow-up — it affects FAQ/testimonial
   * copy only, and cannot reach design placement, which is isolated from it by construction.
   */
  const cmsFaqs = await listPublished('faq');
  const faqs: FaqItem[] =
    cmsFaqs.length > 0
      ? cmsFaqs.map((f) => ({
          question: f.title,
          answer: f.content ?? '',
          category: typeof f.metadata.category === 'string' ? f.metadata.category : null,
        }))
      : PLACEHOLDER_FAQ;

  return (
    <div className="brand-surface flex min-h-screen flex-col font-ui">
      <PublicHeader />

      <main className="flex-1">
        {/* ── Masthead ────────────────────────────────────────────────────── */}
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <Reveal className="max-w-3xl" distance="sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Contact &amp; FAQ</p>
              <h1 className="mt-4 text-balance font-display text-5xl font-normal leading-[1.02] tracking-tight text-primary sm:text-6xl">
                We’d love to hear from you.
              </h1>
              <p className="mt-6 max-w-2xl text-pretty text-lg font-light leading-relaxed text-muted-foreground">
                Questions about custom sizes, order tracking, or corporate gifting? Our team in
                Bengaluru is here to help — and the answers below cover what we are asked most.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Contact ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8" aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="sr-only">
            Contact details
          </h2>
          <div className="grid gap-8 md:grid-cols-2">
            <Reveal className="space-y-6" distance="sm">
              <div className="border border-border bg-card p-6 shadow-xs">
                <h3 className="mb-5 font-display text-xl font-medium tracking-tight text-primary">
                  Get in touch directly
                </h3>
                <div className="space-y-5">
                  {CONTACTS.map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.title} className="flex items-start gap-3.5 text-sm">
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                        <div>
                          <h4 className="font-semibold text-foreground">{c.title}</h4>
                          <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>
                          <a
                            href={c.href}
                            className="mt-1 block rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {c.value}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-start gap-3.5 text-sm">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                    <div>
                      <h4 className="font-semibold text-foreground">Office address</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">Malnad Stories Private Limited</p>
                      <p className="mt-1.5 text-xs font-light leading-relaxed text-foreground">
                        12, Wood Street, Richmond Town,
                        <br />
                        Bengaluru, Karnataka 560025
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-border bg-primary/5 p-6">
                <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-medium text-primary">
                  <LifeBuoy className="h-5 w-5 shrink-0 text-gold" aria-hidden /> Already have an account?
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Open a trackable support ticket inside your dashboard to reference your specific
                  orders and uploaded albums.
                </p>
                <div className="mt-4">
                  <Button render={<Link href="/login" />} variant="outline" size="sm">
                    Go to support tickets
                  </Button>
                </div>
              </div>
            </Reveal>

            {/* Pre-auth message form — UNCHANGED and still presentational.
                TODO (pre-existing): no public/pre-auth contact endpoint exists in the backend.
                Authenticated ticketing goes through /support (createTicket). Wire this up only if
                a public contact endpoint is added later. */}
            <Reveal delay={80} className="border border-border bg-card p-6 shadow-xs" distance="sm">
              <h3 className="mb-5 font-display text-xl font-medium tracking-tight text-primary">Send a message</h3>
              <form className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Your name</Label>
                  <Input id="c-name" name="name" type="text" placeholder="e.g. Priya Sharma" className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-email">Email address</Label>
                  <Input id="c-email" name="email" type="email" placeholder="e.g. priya@example.com" className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-subject">Subject</Label>
                  <Input id="c-subject" name="subject" type="text" placeholder="e.g. Bulk order inquiry" className="rounded-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-message">Message</Label>
                  <textarea
                    id="c-message"
                    name="message"
                    rows={4}
                    placeholder="Write your message here…"
                    className="w-full resize-y rounded-sm border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow,border-color] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                <Button type="button" className="h-10 w-full" disabled>
                  Send message
                </Button>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  For secure, trackable requests, ticketing is managed inside your dashboard.
                </p>
              </form>
            </Reveal>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section
          className="border-t border-border/60 bg-secondary/30"
          aria-labelledby="faq-heading"
        >
          <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 lg:py-28">
            <Reveal distance="sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Answers</p>
              <h2
                id="faq-heading"
                className="mt-3 font-display text-4xl font-normal tracking-tight text-primary sm:text-5xl"
              >
                Questions, answered
              </h2>
            </Reveal>
            <Reveal delay={80} className="mt-12" distance="sm">
              <FaqAccordion items={faqs} />
            </Reveal>
            <Reveal delay={120} className="mt-10 text-center" distance="sm">
              <p className="text-sm font-light text-muted-foreground">
                Still not sure?{' '}
                <a
                  href="mailto:support@malnadstories.com"
                  className="rounded-sm font-semibold text-primary underline-offset-4 hover:text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Write to us
                </a>{' '}
                and a person will answer.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
