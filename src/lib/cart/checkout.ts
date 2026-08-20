import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listCartItems } from '@/lib/cart/queries';
import { priceFor, getAlbumProductSnapshot } from '@/lib/products/catalog';
import { hasPaidOrder } from '@/lib/orders/album-lock';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';

/**
 * SERVER-SIDE CART RESOLUTION for combined checkout (Phase 8).
 *
 * ONE resolver, TWO callers: the `/checkout/cart` page renders what it returns, and
 * `createCombinedOrder` prices and charges from it. Sharing it is the point — a projection the
 * page computed one way and an order the action computed another way is exactly how a customer
 * ends up charged something they were never shown.
 *
 * NOTHING HERE COMES FROM THE BROWSER. The album list is the customer's own `cart_items` (RLS),
 * each price is `priceFor(product, pages)`, each title and product snapshot is read from the
 * album row, and eligibility is re-checked per album. The caller passes only a Supabase client.
 *
 * It is a PROJECTION, not a reservation: it writes nothing and holds nothing. The authoritative
 * pass happens inside `createCombinedOrder` at pay time, which calls this again — so a cart
 * edited between opening checkout and pressing Pay is priced as it is *then*, never as it was.
 */

export type CheckoutLine = {
  albumId: string;
  albumTitle: string;
  size: number;
  subtitle: string | null;
  /** Already normalized server-side; `null` = this album has no cover design. */
  cover: CoverConfig | null;
  copies: number;
  unitPriceInr: number;
  lineSubtotalInr: number;
  productId: string | null;
  productName: string | null;
  productDimensions: unknown;
};

/** An album in the cart that cannot be ordered, and the reason a customer can act on. */
export type BlockedLine = {
  albumId: string;
  albumTitle: string;
  reason: 'not-submitted' | 'blueprint' | 'already-ordered' | 'unavailable' | 'no-price';
  message: string;
};

export type CartResolution = {
  lines: CheckoutLine[];
  blocked: BlockedLine[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function resolveCartForCheckout(supabase: SupabaseClient): Promise<CartResolution> {
  const cart = await listCartItems(supabase);
  if (cart.length === 0) return { lines: [], blocked: [] };

  const { data: albumRows } = await supabase
    .from('albums')
    .select('id, title, size, status, product_id, blueprint_draft_of, destination, travel_dates, cover_config')
    .in(
      'id',
      cart.map((c) => c.album_id),
    );
  const albums = new Map(
    ((albumRows ?? []) as {
      id: string;
      title: string;
      size: number;
      status: string;
      product_id: string | null;
      blueprint_draft_of: string | null;
      destination: string | null;
      travel_dates: string | null;
      cover_config: unknown;
    }[]).map((a) => [a.id, a]),
  );

  // Each album resolves INDEPENDENTLY, so the per-album work runs in parallel rather than one
  // album at a time. Measured before the change: ~517ms per album (three sequential round trips
  // each - the paid check, the price and the product snapshot), so a three-album cart took
  // ~1.55s and a ten-album cart would have crossed five seconds, well past the project's own
  // 800ms slow-query threshold. The queries themselves are unchanged and still one per fact;
  // only the serialisation is gone, so the result is identical by construction.
  //
  // Order is preserved by resolving into a positional array and partitioning afterwards, NOT by
  // pushing from concurrent tasks: the page, the order lines and `orders.album_id`'s first-item
  // pointer must all agree on which album is first.
  type Resolved = { ok: true; line: CheckoutLine } | { ok: false; blocked: BlockedLine };
  const resolved: Resolved[] = await Promise.all(
    cart.map(async (row): Promise<Resolved> => {
      const album = albums.get(row.album_id);
      if (!album) {
        return {
          ok: false,
          blocked: {
            albumId: row.album_id,
            albumTitle: 'This album',
            reason: 'unavailable',
            message: 'This album is no longer available. Remove it from your cart to continue.',
          },
        };
      }
      const title = album.title ?? 'Album';
      if (album.blueprint_draft_of !== null) {
        return {
          ok: false,
          blocked: { albumId: album.id, albumTitle: title, reason: 'blueprint', message: `“${title}” cannot be ordered.` },
        };
      }
      if (album.status !== 'submitted') {
        return {
          ok: false,
          blocked: {
            albumId: album.id,
            albumTitle: title,
            reason: 'not-submitted',
            message: `“${title}” isn’t finished yet — submit it in the builder, or remove it from your cart.`,
          },
        };
      }
      // The three independent facts for this album, fetched together instead of in sequence.
      const [alreadyOrdered, unitPrice, snapshot] = await Promise.all([
        hasPaidOrder(supabase, album.id),
        priceFor(album.product_id, album.size),
        getAlbumProductSnapshot(album.product_id),
      ]);
      if (alreadyOrdered) {
        return {
          ok: false,
          blocked: {
            albumId: album.id,
            albumTitle: title,
            reason: 'already-ordered',
            message: `“${title}” has already been ordered. Remove it from your cart to continue.`,
          },
        };
      }
      if (unitPrice == null) {
        return {
          ok: false,
          blocked: {
            albumId: album.id,
            albumTitle: title,
            reason: 'no-price',
            message: `Pricing for “${title}” is unavailable. Please contact support.`,
          },
        };
      }
      const copies = Math.min(10, Math.max(1, row.quantity));
      return {
        ok: true,
        line: {
          albumId: album.id,
          albumTitle: title,
          size: album.size,
          subtitle: [album.destination, album.travel_dates].filter(Boolean).join(' · ') || null,
          // NULL stays NULL — an album that was never designed keeps the bound-book fallback
          // rather than being handed an invented default config.
          cover: album.cover_config
            ? (normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]) as CoverConfig)
            : null,
          copies,
          unitPriceInr: round2(unitPrice),
          lineSubtotalInr: round2(round2(unitPrice) * copies),
          productId: snapshot.productId,
          productName: snapshot.productName,
          productDimensions: snapshot.dimensions,
        },
      };
    }),
  );

  const lines: CheckoutLine[] = [];
  const blocked: BlockedLine[] = [];
  for (const r of resolved) {
    if (r.ok) lines.push(r.line);
    else blocked.push(r.blocked);
  }
  return { lines, blocked };
}
