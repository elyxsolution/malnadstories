'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { CreateOrderSchema, CancelOrderSchema } from '@/lib/validations';
import { computeOrderAmount } from '@/lib/pricing';
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

// "Active" = a live order we must not duplicate. Paid+ blocks a new order outright;
// a pending one is reused so a double-click can't mint two Razorpay orders.
const PAID_STATES = ['paid', 'processing', 'shipped', 'delivered'];

/**
 * Create (or resume) a checkout for a SUBMITTED album the user owns.
 *
 * Ownership + reads go through the AUTHENTICATED client (RLS). The amount is
 * computed SERVER-SIDE from the album's product — the client sends only ids. The
 * orders row is written with the SERVICE-ROLE client because `authenticated` has no
 * INSERT grant on orders (the intended money boundary). "paid" is never set here —
 * only the webhook does that.
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
  const { albumId, addressId } = parsed.data;

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

  const admin = createServiceClient();
  const keyId = publicKeyId();

  // Double-submission guard.
  const { data: existingRows } = await supabase
    .from('orders')
    .select('id, status, total_amount, razorpay_order_id')
    .eq('album_id', albumId)
    .order('placed_at', { ascending: false });
  const existing = (existingRows ?? []) as {
    id: string;
    status: string;
    total_amount: string;
    razorpay_order_id: string | null;
  }[];

  if (existing.some((o) => PAID_STATES.includes(o.status))) {
    return { ok: false, error: 'This album has already been ordered.' };
  }

  const pending = existing.find((o) => o.status === 'pending' && o.razorpay_order_id);
  if (pending) {
    // Resume the existing checkout. Keep the address current (price is by size, so
    // changing address can't desync the amount). UPDATE goes via service-role.
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

  // Server-side amount from the album's product (RLS allows active-product SELECT).
  const { data: products } = await supabase
    .from('products')
    .select('base_price')
    .eq('pages', album.size)
    .eq('is_active', true)
    .limit(1);
  const product = ((products ?? []) as { base_price: string }[])[0];
  if (!product) return { ok: false, error: 'Pricing for this album size is unavailable.' };

  const amount = computeOrderAmount(Number(product.base_price));

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
      total_amount: amount.totalInr,
      razorpay_order_id: rzpOrderId,
    })
    .select('id')
    .single();

  if (insErr || !orderRow) {
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
 * Cancel a PENDING order (e.g. the user closed the Razorpay modal without paying).
 * Owner-verified via the authenticated client (RLS); the status flip goes through
 * the service-role client (authenticated has no UPDATE grant), guarded to only
 * touch a still-pending row so it can't race a webhook that just marked it paid.
 * Unlocks album deletion after an abandoned checkout.
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
