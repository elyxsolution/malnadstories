/**
 * Presentation for a PURCHASED order's lifecycle status. Pure data + a lookup, so
 * it is safe to import from both Server and Client Components. The set of statuses
 * mirrors PAID_STATES in `album-lock.ts` (the DB is the source of truth — these are
 * only labels/messages, never the gate).
 */

export type PurchasedStatus = 'paid' | 'processing' | 'shipped' | 'delivered';

export type OrderStatusView = {
  label: string;
  message: string;
  /** Coarse tone so UIs can colour the badge without re-deriving it. */
  tone: 'success' | 'info';
};

export const ORDER_STATUS_VIEW: Record<PurchasedStatus, OrderStatusView> = {
  paid: { label: 'Paid', message: 'Payment completed successfully.', tone: 'success' },
  processing: { label: 'Processing', message: 'We are preparing your order.', tone: 'info' },
  shipped: { label: 'In transit', message: 'Your order is on the way.', tone: 'info' },
  delivered: { label: 'Delivered', message: 'Order delivered.', tone: 'success' },
};

/** Never hardcode copy at call sites — resolve it here so every surface matches. */
export function orderStatusView(status: string): OrderStatusView {
  return (
    ORDER_STATUS_VIEW[status as PurchasedStatus] ?? {
      label: status,
      message: '',
      tone: 'info',
    }
  );
}
