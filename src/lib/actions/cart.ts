'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { AddToCartSchema, RemoveFromCartSchema, UpdateCartQuantitySchema } from '@/lib/validations';
import {
  addOrIncrementCartItem,
  ensureCartItem,
  getCartCount,
  removeCartItem,
  setCartQuantity,
} from '@/lib/cart/queries';

/**
 * `count` is the authoritative number of DISTINCT ALBUMS in the cart after the write, read back
 * through the same `getCartCount` the app layout uses. The badge is set from it directly rather
 * than nudged by ±1, which is what `CartProvider.setCount` was reserved for ("a Phase 7
 * mutation that knows the new total"). It also settles the distinct-album rule for free: adding
 * an album that was already in the cart returns the SAME count, so the badge cannot drift
 * upward on a second add, and no separate "did this row already exist?" query is needed.
 */
export type CartActionResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * Revalidate every surface that renders a cart-derived number.
 *
 * `/dashboard` (layout scope) exists because the badge is produced by `(app)/layout.tsx`'s
 * single server-side count. `/cart` is listed too: path revalidation is keyed on the URL, so
 * revalidating `/dashboard` does not refresh a page at `/cart`, and the cart page must re-read
 * its own rows after a mutation made from it.
 */
function revalidateCartSurfaces() {
  revalidatePath('/dashboard', 'layout');
  revalidatePath('/cart');
}

/**
 * Add an album to the signed-in customer's cart, or increase the copies already there.
 *
 * THE CLIENT SUPPLIES ONLY `albumId` AND `quantity`. Identity comes from `getUser()`, so a
 * forged `user_id` has nowhere to enter; price and product data are never accepted, because
 * `createOrder` remains the only thing that decides what an album costs.
 *
 * OWNERSHIP is proven the same way `createOrder` proves it: the album is re-read through
 * the RLS-scoped authenticated client, so another customer's album simply resolves to
 * `null` and returns the ordinary "not found" — no separate existence oracle.
 *
 * The increment is atomic (see `addOrIncrementCartItem`), so two tabs adding at once cannot
 * duplicate a row or lose a copy.
 */
export async function addAlbumToCart(input: unknown): Promise<CartActionResult> {
  const parsed = AddToCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, quantity } = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Ownership gate (RLS): a foreign or nonexistent album resolves to null.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, status, blueprint_draft_of')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumRow as { id: string; status: string; blueprint_draft_of: string | null } | null;
  if (!album) return { ok: false, error: 'Album not found' };

  // BLUEPRINT DRAFTS ARE NOT PRODUCTS. A draft (0046) is an admin authoring scaffold: it
  // carries no photos, is hidden from the library, and is destroyed by CASCADE when its
  // blueprint is re-opened or deleted. It is checked HERE — server-side — rather than
  // relying on the dashboard hiding it or on RLS, because neither is a purchase-eligibility
  // rule. (Phase 6 Prompt 9 blocked the same albums from generating PDFs, for the same
  // reason: they are not things a customer can buy.)
  if (album.blueprint_draft_of !== null) {
    return { ok: false, error: 'This album cannot be added to the cart.' };
  }

  // ELIGIBILITY MATCHES CHECKOUT, deliberately. `createOrder` refuses anything that is not
  // `submitted`, so accepting a draft here would only let a customer fill a cart with items
  // that cannot be bought — the failure would just surface later, further from the cause.
  if (album.status !== 'submitted') {
    return { ok: false, error: 'Finish and submit the album before adding it to your cart.' };
  }

  const result = await addOrIncrementCartItem(supabase, albumId, quantity);
  if (!result.ok) return result;

  // The badge is rendered from the app layout's server-side count, so the layout has to be
  // re-read for it to move. `layout` scope keeps this to the chrome rather than blowing away
  // every cached customer page.
  revalidateCartSurfaces();
  return { ok: true, count: await getCartCount(supabase) };
}

/**
 * MAKE SURE an album is in the cart — without changing the quantity if it already is.
 *
 * The post-submission dialog's "Add to cart & create one more album" needs exactly this. It cannot
 * use `addAlbumToCart`: `submitAlbum` has ALREADY called `ensureCartItem` for this album moments
 * earlier, so incrementing here would leave the customer at quantity 2 for an album they asked to
 * buy once. It also cannot silently do nothing, because the submit-time auto-add is best-effort
 * (it is wrapped in a try/catch so a cart failure can never fail a submission) — so the album may
 * genuinely not be there.
 *
 * "Ensure" and "increment" are two deliberately separate helpers in this codebase (see
 * `lib/cart/queries`); this is the action-level door to the first of them, and it reuses the same
 * ownership, blueprint and `submitted` gates `addAlbumToCart` applies rather than inventing a
 * second eligibility rule.
 */
export async function ensureAlbumInCart(input: unknown): Promise<CartActionResult> {
  const parsed = AddToCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId } = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Same three gates as `addAlbumToCart`, read through the RLS-scoped client: a foreign album
  // resolves to null and returns the ordinary "not found" rather than acting as an existence oracle.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, status, blueprint_draft_of')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumRow as { id: string; status: string; blueprint_draft_of: string | null } | null;
  if (!album) return { ok: false, error: 'Album not found' };
  if (album.blueprint_draft_of !== null) return { ok: false, error: 'This album cannot be added to the cart.' };
  if (album.status !== 'submitted') {
    return { ok: false, error: 'Finish and submit the album before adding it to your cart.' };
  }

  const result = await ensureCartItem(supabase, albumId);
  if (!result.ok) return result;

  revalidateCartSurfaces();
  return { ok: true, count: await getCartCount(supabase) };
}

/**
 * Remove an album from the cart.
 *
 * NO ALBUM READ, deliberately. Ownership is established by RLS on `cart_items` itself, and
 * eligibility is irrelevant to removal — a customer must be able to empty their cart of an
 * album that has since been ordered, deleted or made ineligible. Reading the album first
 * would add a gate that could only ever refuse a harmless request.
 *
 * Idempotent: removing something already gone is success (see `removeCartItem`).
 */
export async function removeFromCart(input: unknown): Promise<CartActionResult> {
  const parsed = RemoveFromCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const result = await removeCartItem(supabase, parsed.data.albumId);
  if (!result.ok) return result;

  revalidateCartSurfaces();
  return { ok: true, count: await getCartCount(supabase) };
}

/**
 * Set the number of copies for an album in the cart.
 *
 * ABSOLUTE value, never a delta, and no pre-read of the current quantity — see
 * `setCartQuantity` for why that is what keeps two tabs safe.
 *
 * NO ELIGIBILITY RE-READ, for the same reason as removal: a quantity on a row that has become
 * ineligible is harmless, and `createOrder` (paid-family + `submitted` checks) is the gate that
 * actually decides whether it can be bought. A missing row is reported so the page can refresh
 * rather than pretend a change landed.
 */
export async function updateCartQuantity(input: unknown): Promise<CartActionResult> {
  const parsed = UpdateCartQuantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, quantity } = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const result = await setCartQuantity(supabase, albumId, quantity);
  if (!result.ok) return result;
  if (!result.found) return { ok: false, error: 'This album is no longer in your cart.' };

  // The badge does NOT change on a quantity edit (it counts distinct albums), but the cart page
  // itself must re-read so a reload and the rendered value never disagree.
  revalidateCartSurfaces();
  return { ok: true, count: await getCartCount(supabase) };
}
