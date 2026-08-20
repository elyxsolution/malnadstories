import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ORDER LINE ACCESS (0056). Reads for `order_items`, plus the one pure builder that turns
 * priced album data into the snapshot an item stores. Nothing else — the money math lives
 * in `lib/pricing.ts` and order creation lives in the actions.
 *
 * Every read takes a CLIENT rather than creating one, so the caller owns the security
 * boundary (the `lib/cart/queries.ts` convention). Passed the AUTHENTICATED client, RLS
 * scopes rows to the owner through the parent order — which is the only authorization these
 * helpers rely on. They never create a service-role client to decide who may see what;
 * service role belongs only in trusted creation paths that have already established
 * identity with `getUser()`.
 */

/** One purchased line, exactly as stored. */
export type OrderItemRow = {
  id: string;
  order_id: string;
  album_id: string;
  copies: number;
  /** numeric arrives as a string from PostgREST — convert at the point of use. */
  unit_price: string;
  line_subtotal: string;
  product_id: string | null;
  product_name: string | null;
  album_title: string;
};

const ITEM_COLUMNS = 'id, order_id, album_id, copies, unit_price, line_subtotal, product_id, product_name, album_title';

/**
 * The lines of one order, oldest first — the order they were purchased in, which is also
 * the order in which item one supplied `orders.album_id`.
 *
 * Returns [] rather than throwing: a receipt that cannot load its lines must not take the
 * page down. Callers that need to distinguish "no items" from "read failed" should check
 * the parent order separately.
 */
export async function listOrderItems(supabase: SupabaseClient, orderId: string): Promise<OrderItemRow[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select(ITEM_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('listOrderItems error:', error.message);
    return [];
  }
  return (data ?? []) as OrderItemRow[];
}

/**
 * Just the album ids in an order — what the paid-transition side effects (per-album review
 * enqueue, per-album PDF generation, cart clearing) will iterate over.
 *
 * Deliberately separate from `listOrderItems` so those callers cannot accidentally depend
 * on a snapshot field that was correct at purchase time but is stale for a live lookup.
 */
export async function albumIdsForOrder(supabase: SupabaseClient, orderId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('album_id')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('albumIdsForOrder error:', error.message);
    return [];
  }
  return ((data ?? []) as { album_id: string }[]).map((r) => r.album_id);
}

/** The shape `create_order_with_items` expects for each line (0056). */
export type OrderItemSnapshot = {
  album_id: string;
  copies: number;
  unit_price: number;
  line_subtotal: number;
  product_id: string | null;
  product_name: string | null;
  product_dimensions: unknown;
  album_title: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Freeze one line. PURE — every value comes from the caller's server-side resolution
 * (`priceFor` for the price, the album row for the title, `getAlbumProductSnapshot` for the
 * product), never from client input.
 *
 * `line_subtotal` is computed here rather than accepted, so a caller cannot pass a line
 * total that disagrees with `unit_price × copies` — the same arithmetic
 * `create_order_with_items` re-checks in SQL before it will insert anything.
 */
export function buildOrderItemSnapshot(input: {
  albumId: string;
  copies: number;
  unitPriceInr: number;
  albumTitle: string;
  productId: string | null;
  productName: string | null;
  productDimensions: unknown;
}): OrderItemSnapshot {
  const copies = Math.min(10, Math.max(1, Math.round(input.copies)));
  const unit = round2(input.unitPriceInr);
  return {
    album_id: input.albumId,
    copies,
    unit_price: unit,
    line_subtotal: round2(unit * copies),
    product_id: input.productId,
    product_name: input.productName,
    product_dimensions: input.productDimensions ?? null,
    album_title: input.albumTitle,
  };
}
