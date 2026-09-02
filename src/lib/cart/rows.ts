import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listCartItems } from '@/lib/cart/queries';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { PAID_STATES } from '@/lib/orders/album-lock';

/**
 * WHAT IS IN THE CART, AS THE CART PAGE HAS ALWAYS COMPUTED IT.
 *
 * This is an EXTRACTION, not a new read. Every line below was `cart/page.tsx`; it moved here
 * unchanged so a second surface — the builder's cart drawer — can show the same cart without
 * a second, subtly different opinion about what a cart row is. The page now calls this; the
 * drawer's server action calls this; there is one query plan and one eligibility rule.
 *
 * THREE READS, NEVER N+1. `listCartItems` gives album ids and quantities; the album facts and
 * the purchase state each come from ONE batched query keyed on those ids, reduced to a Map.
 * Calling `getPaidOrder` per row would have been one round trip per cart item.
 *
 * IT TAKES A CLIENT, so the caller owns the security boundary — and both callers hand it the
 * AUTHENTICATED one, so RLS scopes all three reads to the owner: the cart rows by
 * `user_id = auth.uid()`, the albums and orders by their own owner policies. A cart row can
 * therefore never surface another customer's album, even if its id were known.
 *
 * ⚠️ NO PRICES, DELIBERATELY — and this is a property of the product, not an omission here.
 * The cart is not a pricing surface: `/checkout/[albumId]`, `/checkout/cart` and `createOrder`
 * remain the only places money is computed, so nothing in this file reads or returns one. A
 * total invented for a drawer would be a second answer to a question only checkout may answer.
 */
export type CartRow = {
  albumId: string;
  title: string;
  size: number;
  /** `submitted` and not already ordered — i.e. what `createOrder` would accept. */
  eligible: boolean;
  subtitle: string | null;
  quantity: number;
  /** Already normalized server-side; `null` = this album has no cover design. */
  cover: CoverConfig | null;
  /** The album's paid order, when it has one. Its presence is what makes a row read-only. */
  order: { orderId: string; status: string } | null;
};

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
  destination: string | null;
  travel_dates: string | null;
  cover_config: unknown;
};

export type CartRows = {
  rows: CartRow[];
  /** Cart rows whose album could not be read back — see the note below. */
  stale: number;
  /** Exactly what `createCombinedOrder` will accept, so a CTA and the server agree. */
  eligibleCount: number;
};

export async function loadCartRows(supabase: SupabaseClient): Promise<CartRows> {
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

  return { rows, stale: items.length - rows.length, eligibleCount: rows.filter((r) => r.eligible).length };
}
