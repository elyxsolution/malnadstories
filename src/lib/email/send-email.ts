import 'server-only';
import { type ReactElement } from 'react';
import { render } from '@react-email/render';
import { createServiceClient } from '@/lib/supabase/service';
import { provider } from './resend';
import { isEmailEnabled } from './config';
import { captureException } from '@/lib/observability/capture';

export type SendResult = { ok: boolean; skipped?: boolean; messageId?: string; error?: string };

type SendArgs = {
  event: string; // 'order.confirmation' | 'order.shipped' | ...
  to: string;
  subject: string;
  react: ReactElement;
  orderId?: string | null;
};

// Bound how long a send may take so a slow/hung provider can never stall the webhook
// or an admin action. On timeout we mark the attempt 'failed' (retryable).
const SEND_TIMEOUT_MS = 8000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('email send timed out')), ms)),
  ]);
}

/**
 * Send one transactional email — idempotent + audited, never throws.
 *
 * Idempotency (order emails): a 'sending' row is CLAIMED before the send. The
 * email_log partial unique index (order_id, event_type) where status in (sending,sent)
 * turns a duplicate webhook / status transition into a no-op, so the email is sent at
 * most once. A failure marks the row 'failed' (releasing the slot for a retry).
 *
 * Best-effort: if email is unconfigured it's skipped; any provider error is logged and
 * swallowed so checkout/fulfilment never break.
 */
export async function sendTransactionalEmail(args: SendArgs): Promise<SendResult> {
  const { event, to, subject, react, orderId = null } = args;

  // Outer guard: this function NEVER throws. Email is best-effort and must never block
  // payment processing, fulfilment progression, or webhook completion — callers can
  // await it safely. Any failure is logged and swallowed.
  try {
    if (!to) return { ok: false, error: 'no recipient' };
    if (!isEmailEnabled()) {
      console.log('[email] disabled — skipping', { event, to });
      return { ok: true, skipped: true };
    }

    const svc = createServiceClient();

    // Claim (order emails only).
    let logId: string | null = null;
    if (orderId) {
      const { data: claimed, error: claimErr } = await svc
        .from('email_log')
        .insert({ event_type: event, recipient: to, order_id: orderId, status: 'sending' })
        .select('id')
        .maybeSingle();
      if (claimErr || !claimed) {
        // 23505 → another send already claimed this (order_id, event); otherwise log it.
        if (claimErr && claimErr.code !== '23505') {
          console.error('[email] claim error', { event, orderId, error: claimErr.message });
        }
        return { ok: true, skipped: true };
      }
      logId = (claimed as { id: string }).id;
    }

    try {
      const html = await render(react);
      const { id } = await withTimeout(provider.send({ to, subject, html }), SEND_TIMEOUT_MS);
      if (logId) {
        await svc.from('email_log').update({ status: 'sent', provider_message_id: id }).eq('id', logId);
      } else {
        await svc
          .from('email_log')
          .insert({ event_type: event, recipient: to, order_id: null, status: 'sent', provider_message_id: id });
      }
      return { ok: true, messageId: id };
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 300) : 'send failed';
      console.error('[email] send failed', { event, to, error: msg });
      // Capture (email): the recipient is intentionally omitted — the sanitizer masks PII anyway,
      // but we don't pass it at all. orderId (uuid) is safe correlation.
      void captureException(e, {
        source: 'email',
        category: 'email',
        severity: 'error',
        metadata: { event, orderId, stage: 'send' },
      });
      // Mark 'failed' (releases the idempotency slot so a retry can re-claim).
      if (logId) {
        await svc.from('email_log').update({ status: 'failed', error: msg }).eq('id', logId);
      } else {
        await svc
          .from('email_log')
          .insert({ event_type: event, recipient: to, order_id: null, status: 'failed', error: msg });
      }
      return { ok: false, error: msg };
    }
  } catch (e) {
    // Last-resort guard (e.g. the claim insert or the service client itself threw).
    console.error('[email] unexpected error — continuing', { event, to, error: String(e) });
    return { ok: false, error: 'email failed' };
  }
}
