'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Sprig } from '@/components/brand';
import { Button } from '@/components/ui/button';

/**
 * Shared public/marketing header (Claude Design Foundations top-nav). Solid paper surface
 * with a hairline rule — no stacked glass on persistent chrome. Tokenized end to end.
 * Presentation + navigation only; every link is an existing public or auth route.
 */
const LINKS = [
  { href: '/destinations', label: 'Destinations' },
  { href: '/stories', label: 'Stories' },
  { href: '/testimonials', label: 'Testimonials' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export function PublicHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Malnad Stories — home">
          <span className="grid h-8 w-8 place-items-center border border-gold-light text-gold">
            <Sprig className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold leading-none text-primary">
            Malnad{' '}
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm font-medium transition-colors ${
                isActive(l.href) ? 'text-primary' : 'text-muted-foreground hover:text-primary'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 md:flex">
          <Button render={<Link href="/login" />} variant="outline" size="sm">
            Log in
          </Button>
          <Button render={<Link href="/signup" />} size="sm">
            Create album
          </Button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="public-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="grid h-11 w-11 place-items-center rounded-sm text-foreground transition-colors hover:bg-accent md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <nav
          id="public-mobile-nav"
          className="animate-fade-in border-t border-border/70 bg-background px-5 py-3 md:hidden"
        >
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center text-sm font-medium transition-colors ${
                    isActive(l.href) ? 'text-primary' : 'text-muted-foreground hover:text-primary'
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2.5 border-t border-border/60 pt-3">
            <Button render={<Link href="/login" />} variant="outline" size="sm" className="flex-1">
              Log in
            </Button>
            <Button render={<Link href="/signup" />} size="sm" className="flex-1">
              Create album
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}

export default PublicHeader;
