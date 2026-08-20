import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * CART DATA ACCESS (0055). Reads and writes for `cart_items`, and nothing else — no
 * pricing, no product lookups, no UI concerns.
 *
 * Every function takes a client rather than creating one, so the caller owns the security
 * boundary. All of them are called with the AUTHENTICATED client: RLS
 * (`user_id = auth.uid()`) is the real gate, exactly as it is for albums and addresses.
 * Nothing in the cart needs the service role, so nothing here reaches for it.
 *
 * WHY THE TWO WRITES ARE SQL FUNCTIONS. PostgREST's `upsert` can only overwrite a column
 * with the value you supply; it cannot express `quantity = least(existing + new, 10)`. Doing
 * that as read-then-write in TypeScript would lose an increment whenever two tabs race, so
 * the arithmetic lives in one statement inside `cart_add_or_increment` (0055). Neither
 * function is SECURITY DEFINER and neither takes a user id — each reads `auth.uid()`
 * itself, so the caller's RLS still applies and there is no user_id parameter to forge.
 */

/** One row of the customer's cart. Deliberately no price/product data — see 0055. */
export type CartItemRow = {
  id: string;
  album_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
};

/**
 * How many DISTINCT ALBUMS are in the cart — the number the badge shows.
 *
 * Not the sum of quantities: an order is per-album with `copies` as an attribute, and the
 * library is album-oriented throughout, so "3 albums" is the number the product actually
 * asks about. `unique (user_id, album_id)` means one row per album, so a row count IS the
 * distinct-album count; the name records which of the two numbers this is.
 *
 * Returns 0 rather than throwing: a chrome badge must never be able to break a page.
 */
export async function getCartCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('cart_items')
    .select('id', { count: 'exact', head: true });
  if (error) {
    console.error('getCartCount error:', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * The customer's cart items, newest first (matching the `(user_id, created_at desc)` index).
 *
 * Returns only the cart's own columns. Phase 7's cart page will also want album titles and
 * covers, but joining them here would bake a presentation decision into the data layer
 * before that page exists — and the albums it needs are one further `in('id', albumIds)`
 * read, not an N+1.
 */
export async function listCartItems(supabase: SupabaseClient): Promise<CartItemRow[]> {
  const { data, error } = await supabase
    .from('cart_items')
    .select('id, album_id, quantity, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('listCartItems error:', error.message);
    return [];
  }
  return (data ?? []) as CartItemRow[];
}

/**
 * MANUAL ADD — "put this many more copies in my cart."
 *
 * Increments an existing row and caps at 10, atomically (see the module note). Deliberately
 * SEPARATE from `ensureCartItem`: one ambiguous "add" helper is a bug waiting to happen,
 * because the two callers want genuinely different things on conflict.
 */
export async function addOrIncrementCartItem(
  supabase: SupabaseClient,
  albumId: string,
  quantity: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('cart_add_or_increment', {
    p_album_id: albumId,
    p_quantity: quantity,
  });
  if (error) {
    console.error('addOrIncrementCartItem error:', error.message);
    return { ok: false, error: 'Could not add to cart.' };
  }
  return { ok: true };
}

/**
 * AUTO-ADD — "make sure this album is in my cart", used by album submission.
 *
 * DO NOTHING on conflict, NOT increment. `submitAlbum` has no guard against an album
 * already being `submitted` and is also the "Resubmit for Review" path, so it can run many
 * times for one album; incrementing here would quietly leave an album at quantity 5 after
 * five resubmissions. The customer asked to submit, not to buy five copies.
 */
export async function ensureCartItem(
  supabase: SupabaseClient,
  albumId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('cart_ensure_item', { p_album_id: albumId });
  if (error) {
    console.error('ensureCartItem error:', error.message);
    return { ok: false, error: 'Could not add to cart.' };
  }
  return { ok: true };
}

/**
 * REMOVE — "take this album out of my cart."
 *
 * Keyed by ALBUM, like every other cart operation: `unique (user_id, album_id)` makes the
 * album the natural key, and using `cart_items.id` instead would introduce a second identity
 * for the same row with nothing gained.
 *
 * OWNERSHIP IS THE DATABASE'S JOB. The `.eq('album_id', …)` filter is the only one written
 * here; `users_own_cart_items` (`USING user_id = auth.uid()`) is what restricts the delete to
 * the caller's own row — a cross-user delete affects zero rows even when the album id is
 * known. An app-layer `user_id` filter would be a copy of that rule, not an addition to it.
 *
 * IDEMPOTENT: an already-absent row is success. The caller asked for "not in cart", and it
 * isn't — a second tab having removed it first is not an error worth surfacing.
 */
export async function removeCartItem(
  supabase: SupabaseClient,
  albumId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('cart_items').delete().eq('album_id', albumId);
  if (error) {
    console.error('removeCartItem error:', error.message);
    return { ok: false, error: 'Could not remove this album from your cart.' };
  }
  return { ok: true };
}

/**
 * SET QUANTITY — "make it exactly this many copies."
 *
 * ABSOLUTE, NOT AN INCREMENT, and deliberately NOT a SQL function. The lost-update race that
 * forced `cart_add_or_increment` into the database comes from computing `existing + delta`,
 * which requires reading the current value first. `quantity = 4` has no read dependency, so
 * two tabs racing simply resolve last-write-wins — which is the correct meaning of "set to 4"
 * — and one plain statement is enough.
 *
 * `updated_at` IS SET EXPLICITLY because `cart_items` has no trigger maintaining it (0055's
 * increment sets it inside its own statement). Omitting it here would silently leave a stale
 * timestamp.
 *
 * The bound is enforced three deep: the Zod schema at the action boundary, this clamp, and
 * `cart_items_quantity_check` in the database. `found` reports whether a row actually
 * existed, so a caller can tell "set to 4" from "there was nothing to set".
 */
export async function setCartQuantity(
  supabase: SupabaseClient,
  albumId: string,
  quantity: number,
): Promise<{ ok: true; found: boolean } | { ok: false; error: string }> {
  const bounded = Math.min(10, Math.max(1, Math.round(quantity)));
  const { data, error } = await supabase
    .from('cart_items')
    .update({ quantity: bounded, updated_at: new Date().toISOString() })
    .eq('album_id', albumId)
    .select('album_id');
  if (error) {
    console.error('setCartQuantity error:', error.message);
    return { ok: false, error: 'Could not update the number of copies.' };
  }
  return { ok: true, found: (data ?? []).length > 0 };
}
