import 'server-only';
import * as React from 'react';
import { sendTransactionalEmail } from './send-email';
import { emailConfig } from './config';
import { loadOrderEmailData } from './order-data';
import { OrderConfirmationEmail } from './templates/order-confirmation';
import { OrderStatusEmail } from './templates/order-status';

/**
 * Typed email events — the surface the webhook + admin fulfilment paths call. Each loads
 * the order's data and renders the matching template; all sending/idempotency/logging
 * lives in sendTransactionalEmail. These never throw (best-effort).
 */

const orderUrl = (id: string) => `${emailConfig.siteUrl}/orders/${id}`;

/** payment.captured → first transition to 'paid' (webhook). Never throws. */
export async function sendOrderConfirmationEmail(orderId: string): Promise<void> {
  try {
    const data = await loadOrderEmailData(orderId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: 'order.confirmation',
      to: data.email,
      orderId,
      subject: `Order confirmed — #${orderId.slice(0, 8)}`,
      react: <OrderConfirmationEmail data={data} orderUrl={orderUrl(orderId)} />,
    });
  } catch (e) {
    // Best-effort: a data-load/render failure must never block the webhook.
    console.error('[email] order.confirmation error — continuing', { orderId, error: String(e) });
  }
}

const STATUS_SUBJECT: Record<string, (short: string) => string> = {
  processing: (s) => `We're preparing your order — #${s}`,
  printing: (s) => `Your album is being printed — #${s}`,
  packed: (s) => `Your order is packed — #${s}`,
  shipped: (s) => `Your order has shipped — #${s}`,
  delivered: (s) => `Your order was delivered — #${s}`,
};

/** A fulfilment transition (admin) → the matching status email. Unknown statuses no-op.
 *  Never throws — a failure must never block the status transition. */
export async function sendOrderStatusEmail(orderId: string, status: string): Promise<void> {
  try {
    const subject = STATUS_SUBJECT[status];
    if (!subject) return;
    const data = await loadOrderEmailData(orderId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: `order.${status}`,
      to: data.email,
      orderId,
      subject: subject(orderId.slice(0, 8)),
      react: (
        <OrderStatusEmail
          data={data}
          status={status}
          orderUrl={orderUrl(orderId)}
          supportEmail={emailConfig.supportEmail}
        />
      ),
    });
  } catch (e) {
    console.error('[email] status email error — continuing', { orderId, status, error: String(e) });
  }
}
