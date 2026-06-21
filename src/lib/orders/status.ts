/**
 * Presentation for a PURCHASED order's lifecycle status. Pure data + lookups, so it
 * is safe to import from both Server and Client Components. The set of statuses
 * mirrors PAID_STATES in `album-lock.ts` (the DB is the source of truth — these are
 * only labels/messages/ordering, never the gate). No status here is invented: every
 * key is an existing backend `orders.status` value.
 */

export type PurchasedStatus =
  | 'paid'
  | 'processing'
  | 'printing'
  | 'packed'
  | 'shipped'
  | 'delivered';

export type OrderStatusView = {
  label: string;
  message: string;
  /** Coarse tone so UIs can colour the badge without re-deriving it. */
  tone: 'success' | 'info';
};

export const ORDER_STATUS_VIEW: Record<PurchasedStatus, OrderStatusView> = {
  paid: {
    label: 'Confirmed',
    message: 'Your order is confirmed — we’re getting it ready for printing.',
    tone: 'success',
  },
  processing: {
    label: 'Being prepared',
    message: 'Your album is being lovingly prepared for printing.',
    tone: 'info',
  },
  printing: {
    label: 'Printing',
    message: 'Your pages are being printed on archival paper, one spread at a time.',
    tone: 'info',
  },
  packed: {
    label: 'Packed',
    message: 'Your album is hand-finished, wrapped, and ready to ship.',
    tone: 'info',
  },
  shipped: { label: 'On its way', message: 'Your album is on its way to you.', tone: 'info' },
  delivered: {
    label: 'Delivered',
    message: 'Your album has arrived. We hope you treasure it.',
    tone: 'success',
  },
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

/**
 * Admin-facing labels — the SINGLE source of truth for how the back-office names an
 * order's status (the customer SoT is ORDER_STATUS_VIEW above). Covers every existing
 * `orders.status` value, including the non-fulfilment ones the customer never sees.
 * No new status is introduced — these are display strings for existing states only.
 * (Chip COLOURS live in lib/admin/format.ts `statusChip`.)
 */
export const ADMIN_ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending payment',
  paid: 'Paid',
  processing: 'Processing',
  printing: 'Printing',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Payment failed',
};

export function adminStatusLabel(status: string): string {
  return ADMIN_ORDER_STATUS_LABELS[status] ?? status;
}

/**
 * The fulfilment journey shown on the order page — the ordered paid-family states
 * exactly as the DB advances them (admin_update_order_status is forward-only over
 * this same sequence). `paid` is the entry point ("Confirmed").
 */
export const FULFILLMENT_STEPS = [
  'paid',
  'processing',
  'printing',
  'packed',
  'shipped',
  'delivered',
] as const satisfies readonly PurchasedStatus[];

/**
 * THE canonical "paid family" — an order in any of these states means the album is
 * purchased/committed to fulfilment. This is the SINGLE source of truth for every
 * edit / upload / delete / checkout lock (album-lock.ts, orders.ts, checkout). It is
 * the same set as FULFILLMENT_STEPS; consumers that need string membership should use
 * `isPaidStatus()` (string-typed) rather than `.includes()` on the typed tuple.
 */
export const PAID_STATES: readonly PurchasedStatus[] = FULFILLMENT_STEPS;

/** String-safe membership test for the paid family (no narrowing needed at call sites). */
export function isPaidStatus(status: string): boolean {
  return (FULFILLMENT_STEPS as readonly string[]).includes(status);
}

/** True while the order can still advance (so the confirmation poller keeps ticking). */
export function isFulfilmentActive(status: string): boolean {
  return status === 'pending' || (isPaidStatus(status) && status !== 'delivered');
}

export type FulfillmentStep = {
  status: PurchasedStatus;
  label: string;
  message: string;
  /** 'done' = already passed, 'current' = where the order is now, 'upcoming' = ahead. */
  state: 'done' | 'current' | 'upcoming';
};

/**
 * Build the timeline for a given order status. Returns one entry per
 * FULFILLMENT_STEP with its done/current/upcoming state derived from the order's
 * real position — no invented stages, purely a projection of `orders.status`.
 */
export function fulfillmentProgress(status: string): FulfillmentStep[] {
  const idx = FULFILLMENT_STEPS.indexOf(status as PurchasedStatus);
  // An unknown/pre-paid status (e.g. 'pending') sits before the first step.
  const current = idx < 0 ? -1 : idx;
  // 'delivered' is the LAST step AND a terminal state: the journey is complete, so the step
  // the order sits on is 'done', not 'current'. Only a non-terminal current step is in
  // progress. (Generic check so any future terminal final step behaves correctly.)
  const atTerminal = current === FULFILLMENT_STEPS.length - 1;
  return FULFILLMENT_STEPS.map((s, i) => {
    const view = ORDER_STATUS_VIEW[s];
    const state: FulfillmentStep['state'] =
      i < current || (i === current && atTerminal) ? 'done' : i === current ? 'current' : 'upcoming';
    return {
      status: s,
      label: view.label,
      message: view.message,
      state,
    };
  });
}
