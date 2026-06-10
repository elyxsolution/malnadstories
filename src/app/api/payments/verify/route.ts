import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyPaymentSignature, fetchRazorpayPayment } from '@/lib/razorpay';
import { sendOrderConfirmationEmail } from '@/lib/email/events';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';

export const runtime = 'nodejs';

const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * Checkout success-callback verification AND reconciliation.
 *
 * Razorpay Checkout's success handler posts the three razorpay_* fields here. We:
 *   1. verify HMAC(order_id|payment_id, key_secret) == signature — proves the
 *      callback is genuine and that this order belongs to the signed-in user (RLS).
 *   2. RECONCILE: fetch the authoritative payment object from Razorpay; if it is
 *      `captured`, drive the SAME atomic process_razorpay_event RPC the webhook uses.
 *
 * This makes the client callback a SECOND, equally-safe path to `paid` so a lost or
 * delayed webhook can no longer strand a genuinely-paid order in `pending`. Safety is
 * preserved because the amount/currency fed to the RPC come from Razorpay (never the
 * client) and the RPC is idempotent: it dedupes on the event id and the paid-family
 * guard prevents any double-consume / downgrade if the real webhook later arrives. The
 * webhook remains the canonical source of truth; this is a backstop, not a replacement.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  // The order must belong to this user (RLS scopes the read).
  const { data: order } = await supabase
    .from('orders')
    .select('id, album_id')
    .eq('razorpay_order_id', razorpay_order_id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const orderAlbumId = (order as { id: string; album_id: string }).album_id;

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // ── Reconcile through the canonical RPC ────────────────────────────────────
  // Fetch the authoritative payment from Razorpay so amount/currency are NEVER
  // client-supplied. If Razorpay is unreachable, return ok anyway — the webhook
  // (and the confirmation poller) remain the backstop; we just couldn't fast-path.
  const payment = await fetchRazorpayPayment(razorpay_payment_id);
  if (payment && payment.order_id === razorpay_order_id && payment.status === 'captured') {
    const admin = createServiceClient();
    // Synthetic, stable event id distinct from any real webhook event id. If the real
    // payment.captured webhook arrives later it carries its own X-Razorpay-Event-Id, so
    // it is NOT deduped against this marker — but the RPC's paid-family guard makes its
    // transition + coupon-consume a no-op, so there is no double effect.
    const { data: result, error } = await admin.rpc('process_razorpay_event', {
      p_event_id: `verify:${razorpay_payment_id}`,
      p_event_type: 'payment.captured',
      p_razorpay_order_id: razorpay_order_id,
      p_payment_id: razorpay_payment_id,
      p_method: payment.method,
      p_amount: payment.amount / 100, // paise → INR; gated against orders.total_amount in the txn
      p_currency: payment.currency,
      p_outcome: 'captured',
    });

    if (error) {
      // Couldn't reconcile now — let the webhook/poller settle it. Still ok to navigate.
      console.error('[payments/verify] reconcile rpc error', {
        orderId: order.id,
        error: error.message,
      });
    } else if (result === 'processed') {
      // First transition to paid via this path → fire the idempotent confirmation email
      // (email_log claim dedupes against the webhook path). Never throws / never blocks.
      try {
        await sendOrderConfirmationEmail(order.id as string);
      } catch (e) {
        console.error('[payments/verify] confirmation email error', { orderId: order.id, error: String(e) });
      }

      // Auto-generate the album PDF (backend workflow). Best-effort + idempotent; the
      // webhook path does the same, and startAlbumPdfGeneration no-ops if already done.
      try {
        await startAlbumPdfGeneration(orderAlbumId, { validate: false, nudge: true });
      } catch (e) {
        console.error('[payments/verify] album-pdf auto-start error', { orderId: order.id, error: String(e) });
      }
    }
    // result 'duplicate' | 'amount_mismatch' | 'order_not_found' → leave to webhook; ok below.
  }

  // Confirmation page polls /api/orders/[id] for 'paid' regardless.
  return NextResponse.json({ ok: true });
}
