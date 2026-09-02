import Link from 'next/link';
import Image from 'next/image';

/**
 * Shared public/marketing footer (Claude Design). Editorial brand block + grouped link
 * columns on the paper surface. Presentation only — every destination is an existing route.
 */
/**
 * The footer mirrors the primary navigation rather than inventing a second information
 * architecture. Pricing is deliberately absent here as well — it is not a destination this
 * product leads with. `Destinations` and `Testimonials` keep their routes and move into a
 * secondary "More" column, so nothing that existed became unreachable.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Explore',
    links: [
      { href: '/', label: 'Home' },
      { href: '/stories', label: 'Stories' },
      { href: '/about', label: 'About' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { href: '/contact', label: 'Contact & FAQ' },
      { href: '/login', label: 'Log in' },
    ],
  },
  {
    heading: 'More',
    links: [
      { href: '/destinations', label: 'Destinations' },
      { href: '/testimonials', label: 'Testimonials' },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-secondary/50">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Malnad Stories — home">
              <Image
                src="/logo.png"
                alt=""
                width={447}
                height={558}
                unoptimized
                className="h-8 w-auto"
              />
              {/* The wordmark, in the brand heading face — the same statement the masthead makes, so
                  the page opens and closes on one typeface. */}
              <span className="font-heading text-lg font-semibold leading-none text-primary">
                Malnad{' '}
                <span className="font-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
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
