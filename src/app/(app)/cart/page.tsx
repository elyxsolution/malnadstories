import Link from 'next/link';
import { AlertTriangle, ShoppingBag, ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { LUX_PRIMARY } from '@/components/brand';
import { listCartItems } from '@/lib/cart/queries';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { PAID_STATES } from '@/lib/orders/album-lock';
import CustomerShell from '@/components/customer-shell';
import EmptyState from '@/components/ui/empty-state';
import CartList, { type CartRow } from './_cart-list';

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
  destination: string | null;
  travel_dates: string | null;
  cover_config: unknown;
};

/**
 * THE CART (Phase 7) — which of the customer's albums they intend to order, and how many
 * copies of each. It is not a pricing surface: `/checkout/[albumId]` and `createOrder` remain
 * the only places money is calculated, so nothing here reads or displays a price.
 *
 * THREE READS, NEVER N+1. `listCartItems` gives album ids and quantities; the album facts and
 * the purchase state each come from ONE batched query keyed on those ids, reduced to a Map —
 * the same shape the orders page (`orders/page.tsx`) and the dashboard already use. Calling
 * `getPaidOrder` per row would have been one round trip per cart item.
 *
 * Every read goes through the authenticated client, so RLS scopes all three to the owner: the
 * cart rows by `user_id = auth.uid()`, the albums and orders by their own owner policies. A
 * cart row can therefore never surface another customer's album, even if its id were known.
 */
export default async function CartPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const items = await listCartItems(supabase);
  const albumIds = items.map((i) => i.album_id);

  const albums = new Map<string, AlbumRow>();
  const purchases = new Map<string, { orderId: string; status: string }>();

  if (albumIds.length > 0) {
    const [{ data: albumRows }, { data: orderRows }] = await Promise.all([
      supabase
        .from('albums')
        .select('id, title, size, status, destination, travel_dates, cover_config')
        .in('id', albumIds),
      // The authoritative "this album is bought" signal — orders.status ∈ PAID_STATES, read
      // through ORDER_ITEMS rather than `orders.album_id` (0056), because an order can contain
      // several albums and that column names only the first: keying on it would show album 2 of a
      // combined purchase as still buyable.
      supabase
        .from('order_items')
        .select('album_id, orders!inner(id, status)')
        .in('album_id', albumIds)
        .in('orders.status', PAID_STATES as unknown as string[]),
    ]);

    for (const a of (albumRows ?? []) as AlbumRow[]) albums.set(a.id, a);
    type PaidLine = { album_id: string; orders: { id: string; status: string } | { id: string; status: string }[] };
    for (const r of (orderRows ?? []) as unknown as PaidLine[]) {
      const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      if (ord && !purchases.has(r.album_id)) purchases.set(r.album_id, { orderId: ord.id, status: ord.status });
    }
  }

  // A cart row whose album is not in the batch is skipped rather than rendered broken or thrown.
  // The album CASCADE means this should be transient at most (deleting an album removes its cart
  // row), but a row that briefly outlives its album must not take the whole cart down with it.
  const rows: CartRow[] = [];
  for (const item of items) {
    const album = albums.get(item.album_id);
    if (!album) continue;
    const purchase = purchases.get(item.album_id) ?? null;
    rows.push({
      albumId: album.id,
      title: album.title,
      size: album.size,
      // Eligible = what `createOrder` will actually accept: a submitted album with no paid order.
      // This drives which control the row offers; the server-side gates remain authoritative.
      eligible: album.status === 'submitted' && !purchase,
      subtitle: [album.destination, album.travel_dates].filter(Boolean).join(' · ') || null,
      quantity: item.quantity,
      // NULL stays NULL — `normalizeCoverConfig` would invent a default config for a missing
      // one, making an album that was never designed look like it has a cover. Normalising here
      // (server-side) also means the client receives plain, already-valid JSON.
      cover: album.cover_config
        ? (normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]) as CoverConfig)
        : null,
      order: purchase,
    });
  }

  const stale = items.length - rows.length;
  // Eligible = exactly what `createCombinedOrder` will accept (submitted, not a blueprint draft,
  // not already ordered) — the row's own `eligible` flag, so the CTA and the server agree.
  const eligibleCount = rows.filter((r) => r.eligible).length;
  const blockedRows = rows.filter((r) => !r.eligible);

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="mx-auto max-w-3xl px-5 py-9 sm:px-8">
        <div className="animate-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Cart</p>
          <h1 className="mt-2 font-display text-[2.4rem] font-semibold leading-none tracking-tight">
            Ready when you are.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {rows.length === 0
              ? 'Albums you’re ready to print will wait here until you order them.'
              : `${rows.length} ${rows.length === 1 ? 'album' : 'albums'} waiting to be printed and bound.`}
          </p>
        </div>

        <div className="mt-8">
          {rows.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="Your cart is empty"
              description="Finish an album and submit it — it lands here, ready to order whenever you are."
              action={{ label: 'Go to your stories', href: '/dashboard' }}
            />
          ) : (
            <>
              <CartList rows={rows} />

              {/*
                CHECKOUT ALL (Phase 8) — one order for every eligible album, one shipping charge.
                Enabled only when at least one row is eligible; when some are not, they are named
                rather than silently dropped, using the SAME eligibility the server enforces
                (`resolveCartForCheckout` / `createCombinedOrder`) rather than a second rule.
                Per-row "Buy now" is untouched for anyone who wants one album alone.
              */}
              <div className="mt-6 border bg-card p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                      {eligibleCount === 0
                        ? 'Nothing ready to order'
                        : `${eligibleCount} ${eligibleCount === 1 ? 'album' : 'albums'} ready`}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {eligibleCount === 0
                        ? 'Finish an album — or remove the ones that can’t be ordered — to check out.'
                        : 'Checked out together: one order, one delivery, shipping charged once.'}
                    </p>
                  </div>
                  {eligibleCount > 0 && (
                    <Button render={<Link href="/checkout/cart" />} className={LUX_PRIMARY}>
                      <ShoppingBag /> Checkout all
                    </Button>
                  )}
                </div>

                {blockedRows.length > 0 && (
                  <ul className="mt-4 space-y-1.5 border-t pt-4 text-[13px] text-muted-foreground">
                    {blockedRows.map((r) => (
                      <li key={r.albumId} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground/70" />
                        <span>
                          <strong className="font-medium text-foreground">{r.title}</strong> —{' '}
                          {r.order ? 'already ordered; remove it to check out the rest.' : 'not finished yet; submit it in the builder or remove it.'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/*
            A cart row whose album no longer resolves was skipped above. It is mentioned HERE
            rather than inside the list because it must also appear when every row was skipped —
            otherwise the badge (which counts rows) would disagree with a page showing nothing and
            explaining nothing. No action is offered: album deletion CASCADEs the cart row away on
            its own, so this is transient at worst.
          */}
          {stale > 0 && (
            <p className="px-1 pt-3 text-xs text-muted-foreground">
              {stale} {stale === 1 ? 'album' : 'albums'} in your cart {stale === 1 ? 'is' : 'are'} no longer available
              and {stale === 1 ? 'was' : 'were'} left out.
            </p>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}
