'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { CreateCombinedOrderSchema, PreviewCombinedOrderSchema } from '@/lib/validations';
import { computeCombinedOrderAmount } from '@/lib/pricing';
import { buildOrderItemSnapshot, type OrderItemSnapshot } from '@/lib/orders/items';
import { shippingFeeInr } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
import { resolveCartForCheckout } from '@/lib/cart/checkout';
import { validateCoupon } from '@/lib/coupons';
import { isCouponLocked, recordCouponFailure, clearCouponFailures } from '@/lib/coupon-abuse';
import { createRazorpayOrder, publicKeyId } from '@/lib/razorpay';
import { rateLimit } from '@/lib/rate-limit';

/**
 * COMBINED CHECKOUT — the BACKEND ONLY (Phase 8 Prompt 2). No UI calls this yet.
 *
 * ONE PURCHASE = ONE ORDER. Every album in the customer's cart becomes one `orders` row with
 * one `order_items` line each, one Razorpay order and (eventually) one payment. That is what
 * lets `process_razorpay_event`, the payments table, the dedupe marker and the coupon
 * consumption stay completely untouched: the invariant they rest on — one application order =
 * one Razorpay order = one amount — is preserved exactly.
 *
 * THE SERVER RE-RESOLVES EVERYTHING. The client sends an address, a delivery tier and an
 * optional coupon code. The album list comes from `cart_items` (RLS-scoped), every price from
 * `priceFor`, every title and product snapshot from the album row, shipping from
 * `shippingFeeInr`, and the total from `computeCombinedOrderAmount`. No price, quantity, title
 * or total is ever accepted from the browser, and the amount handed to Razorpay is the same
 * number written to `orders.total_amount` — which is what the webhook's amount gate compares
 * against.
 *
 * SHIPPING IS CHARGED ONCE per combined order (₹99 / ₹199 / ₹399 by tier), never per album
 * and never per copy.
 */

export type CreateCombinedOrderResult =
  | {
      ok: true;
      orderId: string;
      razorpayOrderId: string;
      amountPaise: number;
      currency: 'INR';
      keyId: string;
      prefill: { name: string; email: string };
      /** What was actually bought, server-resolved — for the confirmation UI of a later prompt. */
      lines: { albumId: string; albumTitle: string; copies: number; unitPriceInr: number; lineSubtotalInr: number }[];
      subtotalInr: number;
      shippingInr: number;
      discountInr: number;
      totalInr: number;
      resumed: boolean;
    }
  | { ok: false; error: string };

type PendingOrder = {
  id: string;
  coupon_id: string | null;
  total_amount: string;
  shipping_method: string;
  razorpay_order_id: string | null;
};

export async function createCombinedOrder(input: unknown): Promise<CreateCombinedOrderResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Same shape and budget as `createOrder`'s limiter, under its own key so one flow cannot
  // exhaust the other.
  const rl = rateLimit(`createCombinedOrder:${user.id}`, 8, 60_000);
  if (!rl.ok) return { ok: false, error: 'Too many attempts. Please wait a moment and try again.' };

  const parsed = CreateCombinedOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { addressId, shippingMethod, couponCode } = parsed.data;
  const shippingInr = shippingFeeInr(shippingMethod);

  // ── 1. The cart IS the order's contents — RE-RESOLVED HERE, at pay time ─────────────
  // The same resolver the checkout page renders from, called again now: a cart edited while
  // checkout was open is therefore priced as it is at this moment, never as the browser last
  // saw it. Nothing about the contents, prices, titles or eligibility comes from the request.
  const { lines: resolved, blocked } = await resolveCartForCheckout(supabase);
  if (blocked.length > 0) {
    // Reported, never silently dropped: quietly charging for a different set than the customer
    // saw is exactly the failure mode to avoid.
    return { ok: false, error: blocked[0].message };
  }
  if (resolved.length === 0) return { ok: false, error: 'Your cart is empty.' };
  const albumIds = resolved.map((l) => l.albumId);

  // ── 2. Address ownership — RLS *and* an explicit owner filter ───────────────────────
  // `addresses` has an admin-read policy, so RLS alone would let an admin customer pass another
  // customer's address id. `create_order_with_items` refuses it too; this makes the app layer
  // agree instead of relying on the database to catch it.
  const { data: addrRow } = await supabase
    .from('addresses')
    .select('id, full_name')
    .eq('id', addressId)
    .eq('user_id', user.id)
    .maybeSingle();
  const address = addrRow as { id: string; full_name: string } | null;
  if (!address) return { ok: false, error: 'Please select a valid delivery address.' };

  // ── 3. Freeze each line ─────────────────────────────────────────────────────────────
  const items: OrderItemSnapshot[] = resolved.map((l) =>
    buildOrderItemSnapshot({
      albumId: l.albumId,
      copies: l.copies,
      unitPriceInr: l.unitPriceInr,
      albumTitle: l.albumTitle,
      productId: l.productId,
      productName: l.productName,
      productDimensions: l.productDimensions,
    }),
  );

  // ── 4. Combined amount — subtotal from the lines, shipping ONCE ─────────────────────
  const preliminary = computeCombinedOrderAmount(
    items.map((i) => ({ unitPriceInr: i.unit_price, copies: i.copies })),
    0,
    shippingInr,
  );

  // ── 5. Coupon: order-wide, validated against the COMBINED subtotal ──────────────────
  // Never consumed here — consumption stays inside process_razorpay_event on the first paid
  // transition. Same brute-force cooldown as the single-album path.
  let couponId: string | null = null;
  let discountInr = 0;
  if (couponCode) {
    const lock = isCouponLocked(user.id);
    if (lock.locked) {
      return { ok: false, error: `Too many invalid coupon attempts. Try again in ${lock.retryAfterSec}s.` };
    }
    const result = await validateCoupon(couponCode, preliminary.subtotalInr);
    if (!result.ok) {
      recordCouponFailure(user.id);
      return { ok: false, error: result.message };
    }
    clearCouponFailures(user.id);
    couponId = result.coupon.id;
    discountInr = result.discountInr;
  }

  const amount = computeCombinedOrderAmount(
    items.map((i) => ({ unitPriceInr: i.unit_price, copies: i.copies })),
    discountInr,
    shippingInr,
  );

  const admin = createServiceClient();
  const keyId = publicKeyId();
  const lines = items.map((i) => ({
    albumId: i.album_id,
    albumTitle: i.album_title,
    copies: i.copies,
    unitPriceInr: i.unit_price,
    lineSubtotalInr: i.line_subtotal,
  }));

  // ── 6. Pending orders: resume an identical one, clear a conflicting one ─────────────
  // The pending order + its lines ARE the checkout snapshot, which is how the single-album
  // path already behaves: identical parameters resume the same Razorpay order (its amount is
  // immutable), anything else is cancelled and reminted so the charge can never disagree with
  // the stored total.
  const { data: pendingRows } = await supabase
    .from('orders')
    .select('id, coupon_id, total_amount, shipping_method, razorpay_order_id')
    .eq('status', 'pending')
    .order('placed_at', { ascending: false });
  const pendings = (pendingRows ?? []) as PendingOrder[];

  const cartKey = keyOf(items.map((i) => ({ album_id: i.album_id, copies: i.copies })));
  let resumable: PendingOrder | null = null;
  const conflicting: string[] = [];

  for (const p of pendings) {
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('album_id, copies')
      .eq('order_id', p.id);
    const pending = ((itemRows ?? []) as { album_id: string; copies: number }[]).map((r) => ({
      album_id: r.album_id,
      copies: r.copies,
    }));
    const sameContents = keyOf(pending) === cartKey;
    const sameMoney =
      (p.coupon_id ?? null) === couponId &&
      p.shipping_method === shippingMethod &&
      Number(p.total_amount) === amount.totalInr;

    if (sameContents && sameMoney && p.razorpay_order_id && !resumable) {
      resumable = p;
    } else if (pending.some((i) => albumIds.includes(i.album_id))) {
      // Shares an album with this cart but is not an exact match — it must go, or two live
      // checkouts would claim the same album (and `orders_one_pending_per_album` only guards
      // the legacy pointer, i.e. the first line).
      conflicting.push(p.id);
    }
  }

  if (resumable) {
    // Address may change freely: it does not affect the amount.
    await admin.from('orders').update({ address_id: addressId }).eq('id', resumable.id);
    return {
      ok: true,
      orderId: resumable.id,
      razorpayOrderId: resumable.razorpay_order_id!,
      amountPaise: Math.round(Number(resumable.total_amount) * 100),
      currency: 'INR',
      keyId,
      prefill: { name: address.full_name, email: user.email ?? '' },
      lines,
      subtotalInr: amount.subtotalInr,
      shippingInr: amount.shippingInr,
      discountInr: amount.discountInr,
      totalInr: amount.totalInr,
      resumed: true,
    };
  }

  for (const id of conflicting) {
    const { data: cancelled } = await admin
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'pending') // never touch an order a webhook just settled
      .select('id, status');
    if (!cancelled || cancelled.length === 0) {
      // It resolved under us. If it is now paid, one of these albums is bought — stop rather
      // than risk charging for it twice.
      const { data: fresh } = await supabase.from('orders').select('status').eq('id', id).maybeSingle();
      const status = (fresh as { status: string } | null)?.status;
      if (status && isPaidStatus(status)) {
        return {
          ok: false,
          error: 'One of these albums was just purchased. Please refresh your cart and try again.',
        };
      }
    }
  }

  // ── 7. Razorpay first, then the atomic order + lines ────────────────────────────────
  let rzpOrderId: string;
  try {
    const rzp = await createRazorpayOrder({
      amountPaise: amount.amountPaise,
      receipt: `cart_${user.id.slice(0, 8)}_${Date.now().toString(36)}`,
      notes: { userId: user.id, albums: String(items.length) },
    });
    rzpOrderId = rzp.id;
  } catch (e) {
    console.error('createRazorpayOrder (combined) failed:', e);
    return { ok: false, error: 'Could not start payment. Please try again.' };
  }

  const { data: newOrderId, error: insErr } = await admin.rpc('create_order_with_items', {
    p_user_id: user.id,
    p_address_id: addressId,
    p_items: items,
    p_subtotal: amount.subtotalInr,
    p_shipping: amount.shippingInr,
    p_discount: amount.discountInr,
    p_total: amount.totalInr,
    p_shipping_method: shippingMethod,
    p_coupon_id: couponId,
    p_razorpay_order_id: rzpOrderId,
  });

  if (insErr || !newOrderId) {
    // 23505 = `orders_one_pending_per_album` (0011) on the FIRST line's album: a concurrent
    // checkout won. The just-minted Razorpay order is simply abandoned (it expires unpaid);
    // nothing was charged. The customer retries and the winner is resumed by the pass above.
    if (insErr?.code === '23505') {
      return {
        ok: false,
        error: 'A checkout for one of these albums is already in progress. Please try again in a moment.',
      };
    }
    console.error('combined order insert failed:', insErr);
    return { ok: false, error: 'Could not create your order. Please try again.' };
  }

  return {
    ok: true,
    orderId: newOrderId as string,
    razorpayOrderId: rzpOrderId,
    amountPaise: amount.amountPaise,
    currency: 'INR',
    keyId,
    prefill: { name: address.full_name, email: user.email ?? '' },
    lines,
    subtotalInr: amount.subtotalInr,
    shippingInr: amount.shippingInr,
    discountInr: amount.discountInr,
    totalInr: amount.totalInr,
    resumed: false,
  };
}

export type CombinedPreviewResult =
  | {
      ok: true;
      subtotalInr: number;
      shippingInr: number;
      discountInr: number;
      totalInr: number;
      couponCode: string | null;
    }
  | { ok: false; error: string };

/**
 * ADVISORY combined preview for the checkout page — when the customer switches delivery tier or
 * applies a coupon. Writes nothing, reserves nothing, consumes no coupon.
 *
 * It re-resolves and re-prices the cart on the server exactly as `createCombinedOrder` will, so
 * the figure shown is the figure that would be charged at that moment — but it is still only a
 * preview: `createCombinedOrder` recomputes authoritatively at pay time, so a stale preview can
 * never underpay.
 */
export async function previewCombinedOrder(input: unknown): Promise<CombinedPreviewResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const rl = rateLimit(`previewCombined:${user.id}`, 30, 60_000);
  if (!rl.ok) return { ok: false, error: 'Too many attempts. Please wait a moment.' };

  const parsed = PreviewCombinedOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { shippingMethod, couponCode } = parsed.data;
  const shippingInr = shippingFeeInr(shippingMethod);

  const { lines, blocked } = await resolveCartForCheckout(supabase);
  if (blocked.length > 0) return { ok: false, error: blocked[0].message };
  if (lines.length === 0) return { ok: false, error: 'Your cart is empty.' };

  const priced = lines.map((l) => ({ unitPriceInr: l.unitPriceInr, copies: l.copies }));
  const base = computeCombinedOrderAmount(priced, 0, shippingInr);

  let discountInr = 0;
  let code: string | null = null;
  if (couponCode) {
    const lock = isCouponLocked(user.id);
    if (lock.locked) {
      return { ok: false, error: `Too many invalid coupon attempts. Try again in ${lock.retryAfterSec}s.` };
    }
    const result = await validateCoupon(couponCode, base.subtotalInr);
    if (!result.ok) {
      recordCouponFailure(user.id);
      return { ok: false, error: result.message };
    }
    clearCouponFailures(user.id);
    discountInr = result.discountInr;
    code = result.coupon.code;
  }

  const amount = computeCombinedOrderAmount(priced, discountInr, shippingInr);
  return {
    ok: true,
    subtotalInr: amount.subtotalInr,
    shippingInr: amount.shippingInr,
    discountInr: amount.discountInr,
    totalInr: amount.totalInr,
    couponCode: code,
  };
}

/** Order-independent fingerprint of a line set, for "is this the same checkout?". */
function keyOf(lines: readonly { album_id: string; copies: number }[]): string {
  return lines
    .map((l) => `${l.album_id}:${l.copies}`)
    .sort()
    .join('|');
}
