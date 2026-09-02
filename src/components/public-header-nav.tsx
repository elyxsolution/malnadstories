'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { LogOut, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AccountMenu from '@/components/account/account-menu';
import { accountMenuLinks } from '@/components/account/account-menu-model';
import { signOut } from '@/lib/actions/auth';
import type { AccountIdentity } from '@/lib/auth/identity';

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
 * about the visitor, and it still does not. The account identity and `loginHref` are RESOLVED
 * SERVER-SIDE by `public-header.tsx` and handed down as plain values, so no session is read in
 * the browser, no auth client is constructed here, and no public page became client-rendered to
 * show them.
 */
export function PublicHeaderNav({
  identity = null,
  loginHref = '/login',
}: {
  /**
   * The signed-in visitor's name + email, resolved SERVER-SIDE, or `null` when nobody is signed
   * in. Presentational ONLY — /dashboard is server-protected; this decides which control is
   * drawn, never who may reach what.
   */
  identity?: AccountIdentity | null;
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
      {/*
        ── THE ROW, AND WHY IT SCALES IN TWO STEPS ────────────────────────────────────────
        The bar grows 64px -> 72px at `lg`, where the actions reach their full 48px. Twelve
        pixels of clearance around a 48px control reads as a bar with a button in it; eight reads
        as a button jammed into a bar.

        Between `md` and `lg` everything renders one step down — 44px controls, 14px type, tighter
        button padding, a 16px nav gap instead of 32px, an 18px wordmark, and 24px of container
        padding instead of 32px.

        That band is MEASURED, not guessed. At exactly 768px the row has 720px of content width,
        and the three groups plus their two 16px gaps need ~691px signed in and ~708px signed
        out (the Login link is wider than the account circle) — 12-29px of slack either way. At
        full size they would need ~755px and collide. For reference the ORIGINAL row — a 28px
        `size="sm"` button — cleared 768px by under 2px, so the tablet band is not tighter than it
        was, it is roomier. Every step here is still far larger than that button, so nothing about
        the intent is lost in the narrow band.

        Below `md` the actions live in the sheet, nothing in the bar changed size, and the height
        is untouched — which is also what keeps the mobile panel's `top-16` correct.
      */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:h-[4.5rem] lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          aria-label="Malnad Stories — home"
        >
          <Image src="/logo.png" alt="" width={447} height={558} priority unoptimized className="h-8 w-auto" />
          {/* The wordmark is brand heading typography, so it takes the heading face explicitly —
              it is a <span> and therefore outside the element rule in globals.css. "Stories"
              stays the small uppercase counterweight it has always been. */}
          <span className="font-heading text-lg font-semibold leading-none text-primary lg:text-xl">
            Malnad{' '}
            <span className="font-ui text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Stories</span>
          </span>
        </Link>

        {/* Desktop nav. The active state is an underline that GROWS from the left rather than a
            colour swap, so moving between sections reads as travel along one row. */}
        <nav className="hidden items-center gap-4 md:flex lg:gap-8" aria-label="Primary">
          {LINKS.map((l) => {
            const active = isActive(l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative whitespace-nowrap rounded-sm py-1 text-sm font-medium transition-colors duration-150 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background ${
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
          RIGHT-HAND ACTIONS. "Explore designs" is the one filled button in the bar; the account
          control sits beside it as the quieter of the two, because a marketing masthead's primary
          action is not "sign in". Both controls are the same height at both steps, so they share a
          baseline whatever the viewport.
        */}
        <div className="hidden items-center gap-2 md:flex lg:gap-3">
          {/*
            "Explore designs" is the masthead's one filled button, and it now reads like it. It
            was `size="sm"` — a 28px control with 12.8px type, which is an admin-toolbar button,
            not the primary action of a marketing site. It is 48px tall with 15px type and real
            horizontal padding at `lg`, 44px with 14px type below it, and at both steps it is the
            same height as the account control beside it so the two sit on one row.
          */}
          <Button
            render={<Link href="/stories" />}
            size="lg"
            className="h-11 rounded-lg px-4 text-sm font-semibold lg:h-12 lg:px-6 lg:text-[15px]"
          >
            Explore designs
          </Button>
          {identity ? (
            <AccountMenu identity={identity} context="public" size="lg" />
          ) : (
            <LoginLink href={loginHref} />
          )}
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
          <Button
            render={<Link href="/stories" />}
            size="lg"
            className="mt-8 h-12 w-full rounded-lg text-[15px] font-semibold"
          >
            Explore designs
          </Button>

          {/*
            The account entry, in the SHEET rather than in the bar. The mobile bar is the logo and
            one control, and adding a second icon beside the menu button would be a redesign of it
            — so the sheet, which is already where every other destination lives, carries this one
            too. Full-width rows, so both states clear 44px without a hit-area rule.
          */}
          {identity ? (
            /*
              MOBILE KEEPS ITS SHEET, and the account lives INSIDE it rather than as a second icon
              crowding the hamburger. The sheet is already the app's scroll container and already
              owns Escape, the scroll lock and focus, so the account is presented here as ordinary
              rows: the identity stated inline, then the same destinations as full-width links.
              A popover floating over an open sheet would be a menu inside a menu — and it is the
              one shape that could fight the sheet's scroll. Nothing here portals, captures a
              pointer, or locks anything of its own.
            */
            <div className="mt-8 border-t border-border/50 pt-6">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid h-10 w-10 flex-none place-items-center rounded-full bg-primary font-display text-[15px] leading-none text-gold-pale"
                >
                  {(identity.name || identity.email || 'U').trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Account
                  </span>
                  <span className="mt-0.5 block truncate font-display text-[15px] leading-tight text-primary">
                    {identity.name}
                  </span>
                  {identity.email && (
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      {identity.email}
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {accountMenuLinks('public').map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="flex min-h-[3rem] w-full items-center gap-3 rounded-sm border border-border bg-card px-4 text-sm font-semibold text-primary transition-colors duration-150 ease-glide hover:border-primary/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <l.icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    {l.label}
                  </Link>
                ))}
                {/* The EXISTING action, in the shape this codebase has always submitted it. */}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex min-h-[3rem] w-full items-center gap-3 rounded-sm px-4 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-glide hover:text-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <LogOut className="h-4 w-4 flex-none" aria-hidden />
                    Log out
                  </button>
                </form>
              </div>
            </div>
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
 * It scales in the same two steps as "Explore designs" and shares the row's horizontal padding
 * with it, so the two read as one pair at one scale — the quiet half and the loud half — rather
 * than a button with a small link tacked beside it.
 */
function LoginLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-glide hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background lg:h-12 lg:px-5 lg:text-[15px]"
    >
      Login
    </Link>
  );
}

/*
 * The account control that used to live here — an icon linking straight to /dashboard — is gone.
 * It is now `components/account/account-menu.tsx`, rendered with `context="public"`, and the
 * app header renders the SAME component with `context="app"`. One control, one identity block,
 * one set of hover and motion rules, two lists of destinations.
 */

export default PublicHeaderNav;
