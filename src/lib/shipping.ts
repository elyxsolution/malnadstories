/**
 * Delivery tiers — the single source of truth for shipping options, shared by the
 * server (pricing/order creation) and the client (checkout selector). NOT marked
 * server-only on purpose: the fee table is public pricing. The CHARGE stays
 * server-authoritative — createOrder recomputes the fee from `method` using
 * `shippingFeeInr()` here, never from a client-supplied amount.
 *
 * Standard intentionally equals the previous flat SHIPPING_INR (₹99) so existing
 * single-tier behaviour and orders are unchanged.
 */

export type ShippingMethod = 'standard' | 'priority' | 'express';

export type ShippingTier = {
  method: ShippingMethod;
  label: string;
  /** Human delivery window, display only (no backend SLA is implied). */
  window: string;
  feeInr: number;
};

export const SHIPPING_TIERS: readonly ShippingTier[] = [
  { method: 'standard', label: 'Standard', window: '7–9 days', feeInr: 99 },
  { method: 'priority', label: 'Priority', window: '4–5 days', feeInr: 199 },
  { method: 'express', label: 'Express', window: '2–3 days', feeInr: 399 },
] as const;

export const DEFAULT_SHIPPING_METHOD: ShippingMethod = 'standard';

const BY_METHOD = new Map(SHIPPING_TIERS.map((t) => [t.method, t] as const));

export function isShippingMethod(v: unknown): v is ShippingMethod {
  return typeof v === 'string' && BY_METHOD.has(v as ShippingMethod);
}

/** Server-authoritative fee lookup. Unknown/missing → standard fee. */
export function shippingFeeInr(method: string | null | undefined): number {
  return BY_METHOD.get((method ?? '') as ShippingMethod)?.feeInr ?? BY_METHOD.get('standard')!.feeInr;
}

/** Tier label for display (order page / review). */
export function shippingLabel(method: string | null | undefined): string {
  return BY_METHOD.get((method ?? '') as ShippingMethod)?.label ?? 'Standard';
}
