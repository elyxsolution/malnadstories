import 'server-only';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { PAID_STATES } from '@/lib/orders/status';
import { sendOrderConfirmationEmail } from '@/lib/email/events';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';

/**
 * THE PAID-TRANSITION CASCADE — one place, both settle paths (Phase 8).
 *
 * The webhook and `/api/payments/verify` both drive the SAME atomic `process_razorpay_event`
 * RPC, and both then have downstream work to do. Before Phase 8 each of them did that work
 * inline for `orders.album_id` — one album. An order can now contain several, so the work moved
 * here and iterates `order_items`, which is the authoritative album list.
 *
 * WHAT IT DOES, per paid order:
 *   1. the order-confirmation email (order-scoped, idempotent via `email_log`)
 *   2. per album: enter the admin review queue (`submit_album_for_review`)
 *   3. per album: start the preview PDF (`startAlbumPdfGeneration`)
 *   4. per album: remove that album from THIS customer's cart
 *   5. revalidate the cart surfaces so the badge reflects the new count
 *
 * IDEMPOTENCY — the important part. This function does not own a lock; every step it performs
 * is already idempotent, which is what makes a duplicate or racing delivery harmless:
 *   • the email claims an `email_log` row before sending (0022), so a second call sends nothing;
 *   • `submit_album_for_review` sets the review to `pending_review` — running it twice reaches
 *     the same state;
 *   • `startAlbumPdfGeneration` short-circuits on `already-ready` and on `in-progress` within
 *     IN_PROGRESS_MS, so a second call enqueues no second job and mints no second token;
 *   • the cart delete is a filtered DELETE — an already-removed row is simply not there;
 *   • `orders.status` is never written here at all.
 * It also refuses to run unless the order is ALREADY in the paid family, so it can never
 * fulfil an unpaid order, and the callers only invoke it when the RPC reported a capture that
 * processed — i.e. on the non-paid → paid transition.
 *
 * SERVICE ROLE, deliberately: this runs from the webhook (no user session at all) and from the
 * verify route after it has proven ownership. Authorization is established by the order row
 * itself — the cart delete is scoped to `orders.user_id`, never to a client-supplied id.
 *
 * NEVER THROWS. A failure in any step is logged and the rest continue: the webhook must not
 * return 503 (and be retried) because an email bounced or a worker was asleep.
 */

export type SettlementResult = {
  settled: boolean;
  reason?: 'order-not-found' | 'not-paid';
  albumIds: string[];
  emailSent: boolean;
  reviewsQueued: number;
  pdfsStarted: number;
  cartRowsCleared: number;
};

export async function settleOrderFulfilment(orderId: string, source: string): Promise<SettlementResult> {
  const empty: SettlementResult = {
    settled: false,
    albumIds: [],
    emailSent: false,
    reviewsQueued: 0,
    pdfsStarted: 0,
    cartRowsCleared: 0,
  };
  const admin = createServiceClient();

  const { data: orderRow, error: orderErr } = await admin
    .from('orders')
    .select('id, user_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr || !orderRow) {
    console.error('[settlement] order not found', { source, orderId, error: orderErr?.message });
    return { ...empty, reason: 'order-not-found' };
  }
  const order = orderRow as { id: string; user_id: string; status: string };

  // The floor: only a paid-family order is ever fulfilled, whatever the caller believed.
  if (!(PAID_STATES as readonly string[]).includes(order.status)) {
    console.log('[settlement] skipped — order is not paid', { source, orderId, status: order.status });
    return { ...empty, reason: 'not-paid' };
  }

  // Album membership comes from order_items, NOT orders.album_id (which names only the first).
  const { data: itemRows, error: itemsErr } = await admin
    .from('order_items')
    .select('album_id')
    .eq('order_id', order.id)
    .order('created_at', { ascending: true });
  if (itemsErr) {
    console.error('[settlement] could not read order items', { source, orderId, error: itemsErr.message });
    return { ...empty, reason: 'order-not-found' };
  }
  // De-duplicated defensively; `unique (order_id, album_id)` already guarantees it.
  const albumIds = Array.from(new Set(((itemRows ?? []) as { album_id: string }[]).map((r) => r.album_id)));

  const result: SettlementResult = { ...empty, settled: true, albumIds };

  // ── 1. Confirmation email — one per ORDER, not per album ────────────────────────────
  try {
    await sendOrderConfirmationEmail(order.id);
    result.emailSent = true;
  } catch (e) {
    console.error('[settlement] confirmation email failed', { source, orderId, error: String(e) });
  }

  // ── 2 + 3. Per album: review queue, then preview PDF ────────────────────────────────
  for (const albumId of albumIds) {
    try {
      await admin.rpc('submit_album_for_review', { p_album_id: albumId, p_customer_id: order.user_id });
      result.reviewsQueued += 1;
    } catch (e) {
      console.error('[settlement] review enqueue failed', { source, orderId, albumId, error: String(e) });
    }
    try {
      const r = await startAlbumPdfGeneration(albumId, { validate: true, nudge: true });
      if (r.ok) result.pdfsStarted += 1;
      console.log('[settlement] album-pdf', { source, orderId, albumId, result: r });
    } catch (e) {
      console.error('[settlement] album-pdf start failed', { source, orderId, albumId, error: String(e) });
    }
  }

  // ── 4. Cart clearing — ONLY the albums that were actually purchased ──────────────────
  // Scoped to this order's albums and this order's owner, so anything else the customer is
  // still deciding about stays exactly where it is. Idempotent: a row already gone is fine.
  if (albumIds.length > 0) {
    const { data: deleted, error: delErr } = await admin
      .from('cart_items')
      .delete()
      .eq('user_id', order.user_id)
      .in('album_id', albumIds)
      .select('id');
    if (delErr) {
      console.error('[settlement] cart clear failed', { source, orderId, error: delErr.message });
    } else {
      result.cartRowsCleared = (deleted ?? []).length;
    }
  }

  // ── 5. The badge is rendered from the app layout's server-side count ─────────────────
  try {
    revalidatePath('/dashboard', 'layout');
    revalidatePath('/cart');
  } catch (e) {
    // Route handlers may revalidate, but never let a cache hint break settlement.
    console.error('[settlement] revalidate failed', { source, orderId, error: String(e) });
  }

  console.log('[settlement] done', { source, orderId, ...result });
  return result;
}
