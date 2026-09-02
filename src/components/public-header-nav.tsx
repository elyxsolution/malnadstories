'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { Menu, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * THE public navigation. Four destinations, and no more.
 *
 * `Destinations`, `Testimonials` and `Pricing` are gone from the primary nav: the site now leads
 * with the thing a visitor is actually choosing — a design — and a price list in the masthead is
 * the wrong first impression for a made-to-order product. The routes themselves are untouched;
 * only their promotion to top-level navigation was removed.
 *
 * The brand mark points at `/`. It is the one link a visitor is certain about, and pointing it at
 * a dashboard is how a marketing site starts feeling like an admin tool.
 */
const LINKS = [
  { href: '/', label: 'Home', exact: true },
  { href: '/stories', label: 'Stories' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact & FAQ' },
];

/**
 * THE INTERACTIVE HALF of the public header — the scroll state and the mobile sheet, exactly as
 * they were. It is a Client Component because both of those are; it has never known anything
 * about the visitor, and it still does not. `signedIn` and `loginHref` are RESOLVED SERVER-SIDE
 * by `public-header.tsx` and handed down as plain values, so no session is read in the browser,
 * no auth client is constructed here, and no public page became client-rendered to show them.
 */
export function PublicHeaderNav({
  signedIn = false,
  loginHref = '/login',
}: {
  /** Presentational ONLY. /dashboard is server-protected; this decides which control is drawn. */
  signedIn?: boolean;
  /** `/login`, carrying a pending Phase 2 continuation when the current URL has one. */
  loginHref?: string;
}) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const isActive = (l: (typeof LINKS)[number]) =>
    l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);

  /**
   * The bar earns its edge only once the page has moved. At the very top it sits flush on the
   * hero with no rule at all, which is what keeps the masthead from looking like chrome bolted
   * onto the design.
   *
   * `{ passive: true }` — this listener never calls `preventDefault`, and saying so lets the
   * browser keep scrolling off the main thread. The handler itself only ever sets a boolean, and
   * only when it actually changes, so React re-renders twice per page rather than per frame.
   */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Any navigation closes the menu. Without this, tapping a link on mobile leaves the panel open
  // over the page it just navigated to.
  useEffect(() => setOpen(false), [pathname]);

  /**
   * Open-menu behaviour: lock the background, close on Escape, and return focus to the button
   * that opened it. Focus is moved INTO the panel on open so the next Tab lands on the first
   * link rather than continuing from wherever the reader was in the page behind it.
   */
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    return () => {
      body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header
      data-scrolled={scrolled ? '' : undefined}
      className="sticky top-0 z-50 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-300 ease-glide data-[scrolled]:border-border/60 data-[scrolled]:bg-background/85 data-[scrolled]:supports-[backdrop-filter]:backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          aria-label="Malnad Stories — home"
        >
          <Image src="/logo.png" alt="" width={447} height={558} priority unoptimized className="h-8 w-auto" />
          <span className="font-display text-lg font-semibold leading-none text-primary">
            Malnad <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
          </span>
        </Link>

        {/* Desktop nav. The active state is an underline that GROWS from the left rather than a
            colour swap, so moving between sections reads as travel along one row. */}
        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = isActive(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative rounded-sm py-1 text-sm font-medium transition-colors duration-150 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background ${
                  active ? 'text-primary' : 'text-muted-foreground hover:text-primary'
                }`}
              >
                {l.label}
                <span
                  aria-hidden
                  className={`absolute -bottom-0.5 left-0 h-px bg-gold transition-[width] duration-300 ease-premium motion-reduce:transition-none ${
                    active ? 'w-full' : 'w-0 group-hover:w-full'
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        {/*
          RIGHT-HAND ACTIONS. "Explore designs" is unchanged and remains the one filled button in
          the bar; the account control sits beside it as the quieter of the two, because a
          marketing masthead's primary action is not "sign in".
        */}
        <div className="hidden items-center gap-3 md:flex">
          <Button render={<Link href="/stories" />} size="sm">
            Explore designs
          </Button>
          {signedIn ? <AccountIcon /> : <LoginLink href={loginHref} />}
        </div>

        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="public-mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="grid h-11 w-11 place-items-center rounded-sm text-foreground transition-transform duration-150 ease-glide active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/*
        MOBILE PANEL — a full-height sheet, not a dropdown.
        It is kept MOUNTED and toggled with opacity/transform so it has a real exit as well as an
        entrance, and `pointer-events-none` + `invisible` when closed so it can never intercept a
        touch meant for the page. Exit is faster than the enter (200ms vs 300ms), which is what
        makes dismissing feel immediate rather than like waiting for an animation.
      */}
      <div
        id="public-mobile-nav"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        data-open={open ? '' : undefined}
        className="invisible fixed inset-x-0 top-16 bottom-0 z-40 translate-y-2 overflow-y-auto overscroll-contain bg-background/98 opacity-0 backdrop-blur-md transition-[opacity,transform,visibility] duration-200 ease-in data-[open]:visible data-[open]:translate-y-0 data-[open]:opacity-100 data-[open]:duration-300 data-[open]:ease-premium motion-reduce:transition-none motion-reduce:translate-y-0 md:hidden"
      >
        <nav aria-label="Primary (mobile)" className="mx-auto max-w-6xl px-5 py-6">
          <ul className="flex flex-col">
            {LINKS.map((l) => {
              const active = isActive(l);
              return (
                <li key={l.href} className="border-b border-border/50">
                  <Link
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-[3.5rem] items-center font-display text-2xl tracking-tight transition-colors duration-150 ${
                      active ? 'text-gold' : 'text-primary'
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Button render={<Link href="/stories" />} size="lg" className="mt-8 w-full">
            Explore designs
          </Button>

          {/*
            The account entry, in the SHEET rather than in the bar. The mobile bar is the logo and
            one control, and adding a second icon beside the menu button would be a redesign of it
            — so the sheet, which is already where every other destination lives, carries this one
            too. Full-width rows, so both states clear 44px without a hit-area rule.
          */}
          {signedIn ? (
            <Link
              href="/dashboard"
              className="mt-3 flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-sm border border-border bg-card px-5 text-sm font-semibold text-primary transition-colors duration-150 ease-glide hover:border-primary/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <User className="h-4 w-4" aria-hidden />
              Your dashboard
            </Link>
          ) : (
            <Link
              href={loginHref}
              className="mt-3 flex min-h-[3rem] w-full items-center justify-center rounded-sm border border-border bg-card px-5 text-sm font-semibold text-primary transition-colors duration-150 ease-glide hover:border-primary/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/**
 * SIGNED OUT — a quiet text link, not a second button. Two filled buttons side by side would
 * make the masthead read as a SaaS app bar; the type weight and the gold hover are the same
 * treatment the nav links already use, so it belongs to the row it sits in.
 *
 * `h-11` gives it a 44px target even though it only renders at `md` and above.
 */
function LoginLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-sm px-2 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-glide hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      Login
    </Link>
  );
}

/**
 * SIGNED IN — one compact control that goes straight to the dashboard.
 *
 * NO DROPDOWN, deliberately. The project has no account popover to reuse, and a menu holding a
 * single destination is a click in the way of the destination. The `User` glyph is the same one
 * `customer-shell` already uses for the account row, so the two surfaces agree on what an
 * account looks like.
 *
 * A real `<a>` (via next/link) rather than a button-with-onClick: it navigates, so it should be
 * openable in a new tab, focusable, and announced as a link. 44x44 exactly.
 */
function AccountIcon() {
  return (
    <Link
      href="/dashboard"
      aria-label="Your account — go to your dashboard"
      className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-primary transition-all duration-150 ease-glide hover:border-primary/40 hover:bg-secondary active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <User className="h-[18px] w-[18px]" aria-hidden />
    </Link>
  );
}

export default PublicHeaderNav;
