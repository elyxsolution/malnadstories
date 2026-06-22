import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { rateLimit, sweepRateLimits } from '@/lib/rate-limit';
import { sendOrderConfirmationEmail } from '@/lib/email/events';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';
import { captureException, captureMessage } from '@/lib/observability/capture';
import { getRequestId } from '@/lib/observability/request-id';

// Node runtime: we need the raw request body + Node crypto for HMAC.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLED = new Set(['payment.captured', 'payment.failed']);

/**
 * Razorpay webhook — the single source of truth for "paid".
 *
 * Order of guarantees:
 *   1. Generous IP rate-limit (cheap shed of junk; real webhooks come from
 *      Razorpay's IPs and a 429 is retried, so legitimate bursts are never lost).
 *   2. HMAC verification over the RAW body BEFORE any parse or state change.
 *   3. Atomic dedupe + state change inside process_razorpay_event (one txn), so a
 *      duplicate is a no-op and a failed write never leaves a dedupe marker behind.
 *
 * HTTP mapping: 400 only for signature failure; 503 when the order isn't found yet
 * or the txn errored (Razorpay retries); 200 for processed/duplicate/ignored.
 */
export async function POST(request: Request) {
  sweepRateLimits();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit(`webhook:${ip}`, 300, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature');
  if (!verifyWebhookSignature(raw, signature)) {
    // Monitoring (Finding 7): signature failures are the canonical sign of a forged
    // webhook or a secret mismatch. Log enough to alert on without leaking the body.
    console.error('[razorpay-webhook] signature verification FAILED', {
      ip,
      eventId: request.headers.get('x-razorpay-event-id'),
      hasSignature: !!signature,
      bodyBytes: raw.length,
    });
    // Capture (auth/warning): forged webhook or secret mismatch. NEVER capture the raw body/signature.
    void captureMessage('Razorpay webhook signature verification failed', {
      source: 'razorpay-webhook',
      category: 'auth',
      severity: 'warning',
      requestId: getRequestId(),
      metadata: { eventId: request.headers.get('x-razorpay-event-id'), hasSignature: !!signature, bodyBytes: raw.length },
    });
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // Stable across delivery retries — our idempotency key.
  const eventId = request.headers.get('x-razorpay-event-id');
  if (!eventId) {
    return NextResponse.json({ error: 'missing event id' }, { status: 400 });
  }

  let body: {
    event?: string;
    payload?: { payment?: { entity?: Record<string, unknown> } };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const event = body.event ?? '';
  if (!HANDLED.has(event)) {
    return NextResponse.json({ ok: true, ignored: event }, { status: 200 });
  }

  const entity = body.payload?.payment?.entity ?? {};
  const razorpayOrderId = entity.order_id as string | undefined;
  const paymentId = entity.id as string | undefined;
  const method = (entity.method as string | undefined) ?? null;
  const amountPaise = (entity.amount as number | undefined) ?? 0;
  const currency = (entity.currency as string | undefined) ?? null;
  if (!razorpayOrderId || !paymentId) {
    // Verified but unusable payload — ack so Razorpay stops retrying.
    return NextResponse.json({ ok: true, skipped: 'missing ids' }, { status: 200 });
  }

  const outcome = event === 'payment.captured' ? 'captured' : 'failed';

  // Service role: orders/payments/webhook_events are off-limits to authenticated.
  const admin = createServiceClient();
  const { data: result, error } = await admin.rpc('process_razorpay_event', {
    p_event_id: eventId,
    p_event_type: event,
    p_razorpay_order_id: razorpayOrderId,
    p_payment_id: paymentId,
    p_method: method,
    p_amount: amountPaise / 100, // entity.amount is paise; payments.amount is INR
    p_currency: currency, // verified against orders.total_amount + 'INR' inside the txn
    p_outcome: outcome,
  });

  if (error) {
    console.error('[razorpay-webhook] rpc error', { eventId, event, error: error.message });
    void captureException(error, {
      source: 'razorpay-webhook',
      category: 'payment',
      severity: 'critical',
      requestId: getRequestId(),
      metadata: { eventId, event, stage: 'process_razorpay_event' },
    });
    return NextResponse.json({ error: 'processing failed' }, { status: 503 });
  }

  console.log('[razorpay-webhook]', { eventId, event, result });

  if (result === 'order_not_found') {
    // Webhook raced ahead of our orders INSERT — ask Razorpay to retry shortly.
    return NextResponse.json({ ok: false, result }, { status: 503 });
  }

  if (result === 'amount_mismatch') {
    // Monitoring (Findings 4 + 7): a captured payment whose amount/currency did NOT
    // match the order — recorded but deliberately NOT fulfilled. Alert on this.
    console.error('[razorpay-webhook] AMOUNT/CURRENCY MISMATCH — order NOT fulfilled', {
      eventId,
      event,
      razorpayOrderId,
      paymentId,
      amountPaise,
      currency,
    });
    void captureMessage('Razorpay amount/currency mismatch — order NOT fulfilled', {
      source: 'razorpay-webhook',
      category: 'payment',
      severity: 'critical',
      requestId: getRequestId(),
      metadata: { eventId, event, razorpayOrderId, paymentId, amountPaise, currency },
    });
    // Ack so Razorpay stops retrying a payload we will never fulfil; ops follows up.
    return NextResponse.json({ ok: false, result }, { status: 200 });
  }

  // Order-confirmation email — attached to the existing 'paid' transition, not a new
  // path. Only a genuine capture that processed reaches here; the email layer is
  // idempotent (email_log claim) so a duplicate/retry webhook never re-sends, and it
  // never throws, so email problems can't fail the webhook. We need the orders.id, not
  // the razorpay order id, so resolve it via the service client.
  if (event === 'payment.captured' && result === 'processed') {
    let albumId: string | null = null;
    try {
      const { data: orderRow } = await admin
        .from('orders')
        .select('id, album_id')
        .eq('razorpay_order_id', razorpayOrderId)
        .maybeSingle();
      const row = orderRow as { id: string; album_id: string } | null;
      albumId = row?.album_id ?? null;
      if (row?.id) await sendOrderConfirmationEmail(row.id);
    } catch (e) {
      console.error('[razorpay-webhook] confirmation email error', { eventId, error: String(e) });
    }

    // Auto-generate the album PDF on the FIRST transition to paid (backend workflow —
    // the customer never triggers this). Best-effort + idempotent: validate:false (a
    // paid album was already completeness-checked at submit), nudge wakes the worker.
    if (albumId) {
      try {
        const r = await startAlbumPdfGeneration(albumId, { validate: false, nudge: true });
        console.log('[razorpay-webhook] album-pdf auto-start', { eventId, albumId, result: r });
      } catch (e) {
        console.error('[razorpay-webhook] album-pdf auto-start error', { eventId, albumId, error: String(e) });
      }
    }
  }

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
