import Link from 'next/link';
import { Sprig } from '@/components/brand';

/**
 * Shared public/marketing footer (Claude Design). Editorial brand block + grouped link
 * columns on the paper surface. Presentation only — every destination is an existing route.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Explore',
    links: [
      { href: '/destinations', label: 'Destinations' },
      { href: '/stories', label: 'Stories' },
      { href: '/testimonials', label: 'Testimonials' },
    ],
  },
  {
    heading: 'Order',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/signup', label: 'Create an album' },
      { href: '/login', label: 'Log in' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { href: '/faq', label: 'FAQ' },
      { href: '/contact', label: 'Contact' },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-secondary/50">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center border border-gold-light text-gold">
                <Sprig className="h-4 w-4" />
              </span>
              <span className="font-display text-lg font-semibold leading-none text-primary">
                Malnad{' '}
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
              </span>
            </Link>
            <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground">
              Premium printed photo albums, hand-bound to order and delivered across India. Every
              memory deserves paper.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                {col.heading}
              </h2>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border/70 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Malnad Stories. All rights reserved.</span>
          <span className="font-display italic">Made in the Western Ghats.</span>
        </div>
      </div>
    </footer>
  );
}

export default PublicFooter;
