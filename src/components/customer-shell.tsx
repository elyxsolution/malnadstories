'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Library, Package, User, Plus, LifeBuoy, ClipboardCheck, ShoppingCart } from 'lucide-react';
import { useCart } from '@/lib/cart/provider';

/**
 * Customer area shell (Claude Design) — the dark forest-green left command rail with the
 * brand mark, primary nav, a gold "New album" CTA and an account chip. Sits beneath the
 * global app header (sticky from top-14). Presentation + navigation only; every link is
 * an existing auth-guarded route. Fully tokenized (forest/gold semantic tokens).
 */
/**
 * `href: null` = the row is shown but does not navigate, because its route does not exist. No
 * row is in that state today — Cart was, through Phase 6, and Phase 7 gave it its real route.
 * The capability is kept because it costs one branch and is the honest way to show a nav item
 * whose page has not shipped.
 */
const NAV: {
  href: string | null;
  label: string;
  /**
   * The label for the phone tab bar, where a tab is ~54px wide at 320px. Only "Your stories"
   * needs one — every other label already fits — so this is optional and falls back to `label`.
   * It is a shorter NAME for the same destination, never a different one.
   */
  shortLabel?: string;
  icon: typeof Library;
  match: (p: string) => boolean;
  cartBadge?: boolean;
}[] = [
  { href: '/dashboard', label: 'Your stories', shortLabel: 'Stories', icon: Library, match: (p: string) => p === '/dashboard' || p.startsWith('/albums') },
  { href: '/cart', label: 'Cart', icon: ShoppingCart, match: (p: string) => p.startsWith('/cart'), cartBadge: true },
  { href: '/orders', label: 'Orders', icon: Package, match: (p: string) => p.startsWith('/orders') },
  { href: '/reviews', label: 'Reviews', icon: ClipboardCheck, match: (p: string) => p.startsWith('/reviews') },
  { href: '/support', label: 'Support', icon: LifeBuoy, match: (p: string) => p.startsWith('/support') },
  { href: '/account', label: 'Account', icon: User, match: (p: string) => p.startsWith('/account') },
];

export default function CustomerShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { count: cartCount } = useCart();
  const initial = (email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)] [--ms-tabbar-h:calc(52px_+_env(safe-area-inset-bottom))]">
      {/* R8 — the rail is a fixed-height sticky column, so anything taller than the viewport was
          simply unreachable: in phone landscape (667x375) its content is 480px inside a 319px
          box, hiding 161px — Support, Account, New album and the user chip could be focused by
          keyboard but never scrolled into view. `overflow-y-auto` makes them reachable and is a
          no-op wherever the content already fits (portrait 611/611, desktop 844/844), which is
          why no other viewport changes. Matches the admin rail, which already scrolls.

          ── PHONE (<sm): THE RAIL IS NOT RENDERED AS A COLUMN AT ALL ─────────────────────────
          It used to stay in the flow at 68px with its labels hidden, so every customer page on a
          390px phone lost 17% of its width to six unlabelled glyphs — and the cart badge, the
          "New album" CTA and the account chip were all `sm:`-hidden inside it, i.e. the column
          was paying for itself in width while showing almost nothing. Below `sm` it is removed
          from the flow (`hidden`) and the SAME six destinations are drawn as a bottom tab bar
          (below), which is where a thumb already is. At `sm` and up nothing here changes: the
          rail is the identical 236px column it has always been. */}
      <aside className="sticky top-14 z-20 hidden h-[calc(100vh-3.5rem)] w-[68px] flex-none flex-col overflow-y-auto bg-primary-deep py-6 text-primary-foreground/80 sm:flex sm:w-[236px]">
        {/*
          NO BRAND BLOCK HERE. The mark and the wordmark sit in the app header directly above
          this rail, so a second copy three rems below it was the same statement made twice —
          and it pushed the actual navigation, which is what this column is for, down the page.
          The rail now opens on "Your stories".

          Only the block was removed: the rail keeps its width, its forest ground, its icons,
          its active treatment, its labels, the New album CTA and the account chip. `py-6`
          already gives the first row the breathing space the block's `mb-9` used to provide,
          so no spacing was re-tuned to compensate.
        */}
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((n) => {
            const active = n.match(pathname);
            const Icon = n.icon;
            const inner = (
              <>
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="hidden sm:inline">{n.label}</span>
                {/*
                  DISTINCT ALBUMS, not total copies: two albums at three copies each reads
                  "2". Hidden entirely at zero — an empty cart is not news, and a "0" chip
                  would be the loudest thing in the sidebar. `tabular-nums` keeps 1 and 9 the
                  same width so the row does not twitch as the count changes.
                */}
                {n.cartBadge && cartCount > 0 && (
                  <span
                    aria-label={`${cartCount} ${cartCount === 1 ? 'album' : 'albums'} in cart`}
                    className="ml-auto hidden min-w-5 rounded-full bg-gold px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none tabular-nums text-primary sm:block"
                  >
                    {cartCount}
                  </span>
                )}
              </>
            );
            const shell = `flex min-h-11 items-center gap-3 rounded-sm px-3 py-3 text-sm transition-colors ${
              active
                ? 'bg-primary-foreground/[0.1] font-semibold text-primary-foreground'
                : 'text-primary-foreground/70 hover:bg-primary-foreground/[0.05] hover:text-primary-foreground'
            }`;
            // No route yet (see NAV): show the row, but do not pretend it goes anywhere.
            if (n.href === null) {
              return (
                <div key={n.label} aria-disabled className={`${shell} cursor-default hover:bg-transparent hover:text-primary-foreground/70`}>
                  {inner}
                </div>
              );
            }
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={shell}>
                {inner}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-2 px-3">
          <Link
            href="/albums/new"
            className="flex min-h-11 items-center justify-center gap-2 rounded-sm bg-gold-pale px-3 py-3 text-[13px] font-semibold text-primary transition-colors hover:bg-gold-pale/85"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New album</span>
          </Link>
          <Link
            href="/account"
            className="mt-1 flex items-center gap-3 rounded-sm px-1 py-2 text-primary-foreground/55 transition-colors hover:text-primary-foreground"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-primary-light font-display text-sm text-gold-pale">
              {initial}
            </span>
            <span className="hidden min-w-0 leading-tight sm:block">
              <span className="block truncate text-[13px] text-primary-foreground/80">{email}</span>
              <span className="block text-[11px] text-primary-foreground/45">View account</span>
            </span>
          </Link>
        </div>
      </aside>

      {/*
        THE CONTENT. `pb-[--ms-tabbar-h]` on phone reserves exactly the height of the fixed tab
        bar below, so the last thing on a page is reachable rather than sitting under the
        navigation. The variable is declared here and read by the bar itself and by the two
        sticky phone action bars (cart, checkout), so there is ONE height, not four guesses.
      */}
      <main className="min-w-0 flex-1 font-ui max-sm:pb-[var(--ms-tabbar-h)]">{children}</main>

      {/*
        ── PHONE NAVIGATION ───────────────────────────────────────────────────────────────────
        The same six destinations, the same `NAV` array, the same active predicate — presented
        where a thumb already is instead of as a column stealing width. Nothing is added and
        nothing is dropped, so the two presentations cannot drift.

        It keeps the rail's forest ground, so the app still reads as one place; the labels the
        rail hid below `sm` are printed here, because six unlabelled glyphs is not navigation.
        Six equal columns clear 44px of touch width down to 320px (53px each).
      */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-primary-foreground/10 bg-primary-deep pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ul className="flex items-stretch">
          {NAV.map((n) => {
            const active = n.match(pathname);
            const Icon = n.icon;
            const inner = (
              <>
                <span className="relative grid h-7 w-12 place-items-center rounded-full transition-colors duration-150">
                  {/* The active pill sits BEHIND the glyph rather than around the whole tab, so
                      the row keeps one rhythm and the cue reads as a state, not a button. */}
                  <span
                    aria-hidden
                    className={`absolute inset-0 rounded-full transition-opacity duration-150 ${
                      active ? 'bg-primary-foreground/[0.14] opacity-100' : 'opacity-0'
                    }`}
                  />
                  <Icon className="relative h-[18px] w-[18px]" />
                  {n.cartBadge && cartCount > 0 && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-none tabular-nums text-primary"
                    >
                      {cartCount}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-[10px] font-medium leading-none">{n.shortLabel ?? n.label}</span>
              </>
            );
            const shell = `flex min-h-[52px] w-full flex-col items-center justify-center gap-1 px-0.5 pb-1.5 pt-1.5 transition-[color,transform] duration-150 ease-glide active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-pale ${
              active ? 'text-primary-foreground' : 'text-primary-foreground/60'
            }`;
            return (
              <li key={n.label} className="min-w-0 flex-1">
                {n.href === null ? (
                  <div aria-disabled className={`${shell} cursor-default`}>
                    {inner}
                  </div>
                ) : (
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={
                      n.cartBadge && cartCount > 0
                        ? `${n.label} — ${cartCount} ${cartCount === 1 ? 'album' : 'albums'}`
                        : undefined
                    }
                    className={shell}
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
