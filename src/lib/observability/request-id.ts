import 'server-only';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';

/**
 * Request correlation id (Phase 10B). The middleware mints `x-request-id` and forwards it on the
 * request headers, so ANY server code in the request scope — server components, server actions,
 * route handlers, and the libraries they call (email/pdf/razorpay) — can recover the same id with
 * no signature threading. Falls back to a fresh id outside a request scope (best-effort; never
 * throws — `headers()` raises if called outside a request, which we treat as "no scope").
 */
export function getRequestId(): string {
  try {
    const id = headers().get('x-request-id');
    if (id) return id;
  } catch {
    // not in a request scope (e.g. a background task) — fall through to a generated id
  }
  return randomUUID();
}
