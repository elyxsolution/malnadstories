'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Library, Package, User, Plus, LifeBuoy, ClipboardCheck, ShoppingCart } from 'lucide-react';
import { Sprig } from '@/components/brand';
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
  icon: typeof Library;
  match: (p: string) => boolean;
  cartBadge?: boolean;
}[] = [
  { href: '/dashboard', label: 'Your stories', icon: Library, match: (p: string) => p === '/dashboard' || p.startsWith('/albums') },
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
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)]">
      {/* R8 — the rail is a fixed-height sticky column, so anything taller than the viewport was
          simply unreachable: in phone landscape (667x375) its content is 480px inside a 319px
          box, hiding 161px — Support, Account, New album and the user chip could be focused by
          keyboard but never scrolled into view. `overflow-y-auto` makes them reachable and is a
          no-op wherever the content already fits (portrait 611/611, desktop 844/844), which is
          why no other viewport changes. Matches the admin rail, which already scrolls. */}
      <aside className="sticky top-14 z-20 flex h-[calc(100vh-3.5rem)] w-[68px] flex-none flex-col overflow-y-auto bg-primary-deep py-6 text-primary-foreground/80 sm:w-[236px]">
        <Link href="/dashboard" className="mb-9 flex items-center gap-3 px-4 sm:px-6">
          <span className="grid h-8 w-8 flex-none place-items-center border border-gold-light text-gold-pale">
            <Sprig className="h-4 w-4" />
          </span>
          <span className="hidden font-display text-[19px] font-semibold leading-none text-primary-foreground sm:block">
            Malnad
            <span className="block text-[10px] uppercase tracking-[0.2em] text-primary-foreground/45">Stories</span>
          </span>
        </Link>

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

      <main className="min-w-0 flex-1 font-ui">{children}</main>
    </div>
  );
}
