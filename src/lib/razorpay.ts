import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Razorpay server-side helpers — the ONLY place key_secret / webhook secret are
 * read. Dependency-free (REST + Node crypto) so the secrets never leave the server
 * and there's no SDK surface to audit. key_secret + webhook secret must never be
 * NEXT_PUBLIC; key_id is non-sensitive and is handed to the client per-order by the
 * createOrder action (not via env).
 */

const ORDERS_ENDPOINT = 'https://api.razorpay.com/v1/orders';

function keyId(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  if (!id) throw new Error('RAZORPAY_KEY_ID is not set');
  return id;
}

function keySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not set');
  return secret;
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };

/**
 * Create a Razorpay order via the Orders API. `amountPaise` is computed
 * server-side (never from the client). `receipt` is our own reference; `notes`
 * carry the album/user for cross-referencing in the dashboard.
 */
export async function createRazorpayOrder(args: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const res = await fetch(ORDERS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: 'INR',
      receipt: args.receipt.slice(0, 40), // Razorpay caps receipt at 40 chars
      notes: args.notes ?? {},
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Razorpay order create failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/** Constant-time hex-digest comparison; false on any length/format mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a webhook delivery: HMAC-SHA256 of the RAW request body, keyed by the
 * dashboard webhook secret, compared with the X-Razorpay-Signature header. Must be
 * called on the raw bytes BEFORE any JSON parse.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/**
 * Verify the Checkout success callback signature (secondary check):
 * HMAC-SHA256(`${order_id}|${payment_id}`, key_secret) == razorpay_signature.
 * This proves the callback is genuine but does NOT mark the order paid — only the
 * webhook does that.
 */
export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', keySecret())
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}

/** Non-sensitive — safe to hand to the browser so Checkout can open. */
export function publicKeyId(): string {
  return keyId();
}
