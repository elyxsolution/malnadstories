import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { verifyPaymentSignature } from '@/lib/razorpay';

export const runtime = 'nodejs';

const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/**
 * Secondary, client-callback signature check.
 *
 * Razorpay Checkout's success handler posts the three razorpay_* fields here. We
 * verify HMAC(order_id|payment_id, key_secret) == signature so the client can
 * confidently navigate to the confirmation page. This DELIBERATELY does not mark
 * the order paid — fulfillment is driven solely by the verified webhook. Ownership
 * is confirmed via the authenticated client (RLS) so a user can only verify a
 * callback for their own order.
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
    .select('id')
    .eq('razorpay_order_id', razorpay_order_id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Verified, but status stays webhook-driven. Confirmation page polls for 'paid'.
  return NextResponse.json({ ok: true });
}
