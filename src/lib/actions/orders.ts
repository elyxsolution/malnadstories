'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CreateOrderSchema,
  CancelOrderSchema,
  PreviewCouponSchema,
  PreviewOrderSchema,
} from '@/lib/validations';
import { computeOrderAmount } from '@/lib/pricing';
import { shippingFeeInr } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
import { validateCoupon } from '@/lib/coupons';
import { isCouponLocked, recordCouponFailure, clearCouponFailures } from '@/lib/coupon-abuse';
import { createRazorpayOrder, publicKeyId } from '@/lib/razorpay';
import { rateLimit } from '@/lib/rate-limit';

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      razorpayOrderId: string;
      amountPaise: number;
      currency: 'INR';
      keyId: string;
      prefill: { name: string; email: string };
    }
  | { ok: false; error: string };

export type CancelOrderResult = { ok: true } | { ok: false; error: string };

export type PreviewCouponResult =
  | {
      ok: true;
      code: string;
      subtotalInr: number;
      shippingInr: number;
      discountInr: number;
      totalInr: number;
    }
  | { ok: false; error: string };

export type PreviewOrderResult =
  | { ok: true; subtotalInr: number; shippingInr: number; totalInr: number }
  | { ok: false; error: string };

// "Active" = a live order we must not duplicate. Membership in the paid family (the
// canonical set in status.ts, incl. printing/packed) blocks a new order outright; a
// pending one is reused. Use isPaidStatus() so there is one definition, not a copy.

/**
 * Create (or resume) a checkout for a SUBMITTED album the user owns.
 *
 * Ownership + reads go through the AUTHENTICATED client (RLS). The amount is computed
 * SERVER-SIDE from the album's product × copies − a server-validated coupon — the
 * client sends only ids, a copy count, and a code. The orders row is written with the
 * SERVICE-ROLE client (authenticated has no INSERT grant). "paid" is never set here;
 * the coupon is NOT consumed here — both happen only in the webhook.
 */
export async function createOrder(input: unknown): Promise<CreateOrderResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Rate-limit order creation per user (defends the Razorpay Orders API + our DB).
  const rl = rateLimit(`createOrder:${user.id}`, 8, 60_000);
  if (!rl.ok) return { ok: false, error: 'Too many attempts. Please wait a moment and try again.' };

  const parsed = CreateOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, addressId, copies, shippingMethod, couponCode } = parsed.data;
  // Shipping fee is resolved SERVER-SIDE from the tier key (never client-supplied).
  const shippingInr = shippingFeeInr(shippingMethod);

  // Album must exist, belong to the user (RLS), and be submitted.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, size, status')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumRow as { id: string; size: number; status: string } | null;
  if (!album) return { ok: false, error: 'Album not found' };
  if (album.status !== 'submitted') {
    return { ok: false, error: 'Finish and submit the album before checking out.' };
  }

  // Address must belong to the user (RLS). full_name → Checkout prefill.
  const { data: addrRow } = await supabase
    .from('addresses')
    .select('id, full_name')
    .eq('id', addressId)
    .maybeSingle();
  const address = addrRow as { id: string; full_name: string } | null;
  if (!address) return { ok: false, error: 'Please select a valid delivery address.' };

  // Server-side price from the album's product (RLS allows active-product SELECT).
  const { data: products } = await supabase
    .from('products')
    .select('base_price')
    .eq('pages', album.size)
    .eq('is_active', true)
    .limit(1);
  const product = ((products ?? []) as { base_price: string }[])[0];
  if (!product) return { ok: false, error: 'Pricing for this album size is unavailable.' };
  const basePrice = Number(product.base_price);

  // Coupon (optional): validated server-side against the SUBTOTAL. NOT consumed here
  // — consumption is on payment success (webhook). Invalid → reject so the user fixes
  // it before paying. The SAME brute-force defence as previewCoupon applies here
  // (M-1): a per-user cooldown after repeated INVALID attempts, so this path can't be
  // used to enumerate codes around the previewCoupon cooldown. Only failures accrue;
  // a valid code clears the counter.
  const subtotalInr = Math.round(basePrice * copies * 100) / 100;
  let couponId: string | null = null;
  let discountInr = 0;
  if (couponCode) {
    const lock = isCouponLocked(user.id);
    if (lock.locked) {
      return {
        ok: false,
        error: `Too many invalid coupon attempts. Try again in ${lock.retryAfterSec}s.`,
      };
    }
    const result = await validateCoupon(couponCode, subtotalInr);
    if (!result.ok) {
      recordCouponFailure(user.id);
      return { ok: false, error: result.message };
    }
    clearCouponFailures(user.id);
    couponId = result.coupon.id;
    discountInr = result.discountInr;
  }

  const amount = computeOrderAmount(basePrice, copies, discountInr, shippingInr);

  const admin = createServiceClient();
  const keyId = publicKeyId();

  // Existing orders on this album.
  const { data: existingRows } = await supabase
    .from('orders')
    .select('id, status, copies, coupon_id, total_amount, razorpay_order_id')
    .eq('album_id', albumId)
    .order('placed_at', { ascending: false });
  const existing = (existingRows ?? []) as {
    id: string;
    status: string;
    copies: number;
    coupon_id: string | null;
    total_amount: string;
    razorpay_order_id: string | null;
  }[];

  if (existing.some((o) => isPaidStatus(o.status))) {
    return { ok: false, error: 'This album has already been ordered.' };
  }

  const pending = existing.find((o) => o.status === 'pending' && o.razorpay_order_id);
  if (pending) {
    const sameParams =
      pending.copies === copies &&
      (pending.coupon_id ?? null) === couponId &&
      Number(pending.total_amount) === amount.totalInr;

    if (sameParams) {
      // Resume the existing checkout (address may change freely — price is unaffected).
      await admin.from('orders').update({ address_id: addressId }).eq('id', pending.id);
      return {
        ok: true,
        orderId: pending.id,
        razorpayOrderId: pending.razorpay_order_id!,
        amountPaise: Math.round(Number(pending.total_amount) * 100),
        currency: 'INR',
        keyId,
        prefill: { name: address.full_name, email: user.email ?? '' },
      };
    }

    // Copies/coupon changed → the Razorpay amount is immutable, so we cannot reuse it.
    // Cancel the stale pending order (guarded to a still-pending row) before minting a
    // fresh one — 0011 (≤1 pending/album) requires the old one be gone first.
    const { data: cancelledRows } = await admin
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('id');
    if (!cancelledRows || cancelledRows.length === 0) {
      // It resolved under us (a webhook just settled it). Re-check before proceeding.
      const { data: fresh } = await supabase
        .from('orders')
        .select('status')
        .eq('id', pending.id)
        .maybeSingle();
      const freshStatus = (fresh as { status: string } | null)?.status;
      if (freshStatus && isPaidStatus(freshStatus)) {
        return { ok: false, error: 'This album has already been ordered.' };
      }
      // else it failed/cancelled → safe to create a fresh order.
    }
  }

  // Create the Razorpay order first, then persist ours with its id.
  let rzpOrderId: string;
  try {
    const rzp = await createRazorpayOrder({
      amountPaise: amount.amountPaise,
      receipt: `alb_${albumId}`,
      notes: { albumId, userId: user.id },
    });
    rzpOrderId = rzp.id;
  } catch (e) {
    console.error('createRazorpayOrder failed:', e);
    return { ok: false, error: 'Could not start payment. Please try again.' };
  }

  const { data: orderRow, error: insErr } = await admin
    .from('orders')
    .insert({
      user_id: user.id,
      album_id: albumId,
      address_id: addressId,
      status: 'pending',
      copies,
      subtotal_amount: amount.subtotalInr,
      shipping_amount: amount.shippingInr,
      shipping_method: shippingMethod,
      discount_amount: amount.discountInr,
      total_amount: amount.totalInr,
      coupon_id: couponId,
      razorpay_order_id: rzpOrderId,
    })
    .select('id')
    .single();

  if (insErr || !orderRow) {
    // A concurrent createOrder (double-click / network retry) won the race and already
    // inserted the single allowed pending order (0011's unique index → 23505). Reuse
    // the winner so the call is idempotent; our just-created Razorpay order expires.
    if (insErr?.code === '23505') {
      const { data: winnerRows } = await supabase
        .from('orders')
        .select('id, total_amount, razorpay_order_id')
        .eq('album_id', albumId)
        .eq('status', 'pending')
        .order('placed_at', { ascending: false })
        .limit(1);
      const winner = ((winnerRows ?? []) as {
        id: string;
        total_amount: string;
        razorpay_order_id: string | null;
      }[])[0];
      if (winner?.razorpay_order_id) {
        return {
          ok: true,
          orderId: winner.id,
          razorpayOrderId: winner.razorpay_order_id,
          amountPaise: Math.round(Number(winner.total_amount) * 100),
          currency: 'INR',
          keyId,
          prefill: { name: address.full_name, email: user.email ?? '' },
        };
      }
    }
    console.error('order insert failed:', insErr);
    return { ok: false, error: 'Could not create your order. Please try again.' };
  }

  return {
    ok: true,
    orderId: (orderRow as { id: string }).id,
    razorpayOrderId: rzpOrderId,
    amountPaise: amount.amountPaise,
    currency: 'INR',
    keyId,
    prefill: { name: address.full_name, email: user.email ?? '' },
  };
}

/**
 * Live, advisory discount preview for the checkout page. Validates the code
 * server-side against the album's subtotal and returns the resulting breakdown — but
 * writes nothing and reserves nothing. createOrder re-validates + recomputes at pay
 * time (never trust a previewed amount).
 *
 * Abuse defence: a per-user cooldown after repeated INVALID attempts (only failures
 * accrue; a valid code clears it), layered on the generic per-user rate limit.
 */
export async function previewCoupon(input: unknown): Promise<PreviewCouponResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const lock = isCouponLocked(user.id);
  if (lock.locked) {
    return {
      ok: false,
      error: `Too many invalid coupon attempts. Try again in ${lock.retryAfterSec}s.`,
    };
  }
  const rl = rateLimit(`previewCoupon:${user.id}`, 15, 60_000);
  if (!rl.ok) return { ok: false, error: 'Too many attempts. Please wait a moment.' };

  const parsed = PreviewCouponSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, copies, shippingMethod, code } = parsed.data;
  const shippingInr = shippingFeeInr(shippingMethod);

  // Ownership (RLS) + product price by size.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumRow as { id: string; size: number } | null;
  if (!album) return { ok: false, error: 'Album not found' };

  const { data: products } = await supabase
    .from('products')
    .select('base_price')
    .eq('pages', album.size)
    .eq('is_active', true)
    .limit(1);
  const product = ((products ?? []) as { base_price: string }[])[0];
  if (!product) return { ok: false, error: 'Pricing for this album size is unavailable.' };
  const basePrice = Number(product.base_price);

  const subtotalInr = Math.round(basePrice * copies * 100) / 100;
  const result = await validateCoupon(code, subtotalInr);
  if (!result.ok) {
    recordCouponFailure(user.id);
    return { ok: false, error: result.message };
  }
  clearCouponFailures(user.id);

  const amount = computeOrderAmount(basePrice, copies, result.discountInr, shippingInr);
  return {
    ok: true,
    code: result.coupon.code,
    subtotalInr: amount.subtotalInr,
    shippingInr: amount.shippingInr,
    discountInr: amount.discountInr,
    totalInr: amount.totalInr,
  };
}

/**
 * Server-side price for a given copy count (no coupon) — the advisory checkout preview
 * used when the customer changes the number of copies. Computes everything from the
 * album's product server-side; the client only sends ids + a copy count, never an
 * amount. createOrder recomputes authoritatively at pay time.
 */
export async function previewOrderAmount(input: unknown): Promise<PreviewOrderResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const rl = rateLimit(`previewOrder:${user.id}`, 30, 60_000);
  if (!rl.ok) return { ok: false, error: 'Too many attempts. Please wait a moment.' };

  const parsed = PreviewOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, copies, shippingMethod } = parsed.data;
  const shippingInr = shippingFeeInr(shippingMethod);

  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumRow as { id: string; size: number } | null;
  if (!album) return { ok: false, error: 'Album not found' };

  const { data: products } = await supabase
    .from('products')
    .select('base_price')
    .eq('pages', album.size)
    .eq('is_active', true)
    .limit(1);
  const product = ((products ?? []) as { base_price: string }[])[0];
  if (!product) return { ok: false, error: 'Pricing for this album size is unavailable.' };

  const amount = computeOrderAmount(Number(product.base_price), copies, 0, shippingInr);
  return {
    ok: true,
    subtotalInr: amount.subtotalInr,
    shippingInr: amount.shippingInr,
    totalInr: amount.totalInr,
  };
}

/**
 * Cancel a PENDING order (e.g. the user closed the Razorpay modal without paying).
 * Owner-verified via the authenticated client (RLS); the status flip goes through the
 * service-role client (authenticated has no UPDATE grant), guarded to only touch a
 * still-pending row so it can't race a webhook that just marked it paid. Unlocks
 * album deletion after an abandoned checkout.
 */
export async function cancelOrder(input: unknown): Promise<CancelOrderResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = CancelOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { orderId } = parsed.data;

  // Ownership gate (RLS): a foreign/nonexistent order resolves to null.
  const { data: orderRow } = await supabase
    .from('orders')
    .select('id, status, album_id')
    .eq('id', orderId)
    .maybeSingle();
  const order = orderRow as { id: string; status: string; album_id: string } | null;
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'pending') {
    // Diagnostic: a cancel attempt on a non-pending order means the client was stale
    // (e.g. a payment.failed webhook already flipped it). The rule itself is correct.
    console.log('[cancelOrder] rejected non-pending order', { orderId, status: order.status });
    return { ok: false, error: 'Only a pending order can be cancelled.' };
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', orderId)
    .eq('status', 'pending'); // guard against a concurrent webhook flip to paid
  if (error) {
    console.error('cancelOrder error:', error);
    return { ok: false, error: 'Could not cancel the order.' };
  }

  revalidatePath('/dashboard');
  return { ok: true };
}
