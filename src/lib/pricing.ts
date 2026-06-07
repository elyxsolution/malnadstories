import 'server-only';

/**
 * Server-side order pricing — the single source of truth for what a customer pays.
 * The client NEVER sends an amount; it is always derived here from the product
 * base price (looked up by the album's size) plus shipping.
 */

/** Flat nationwide shipping, in INR. */
export const SHIPPING_INR = 99;

export type OrderAmount = {
  subtotalInr: number;
  shippingInr: number;
  totalInr: number;
  amountPaise: number; // what Razorpay's Orders API expects
};

/**
 * Compute the order total from a product base price (INR). Razorpay works in the
 * smallest currency unit (paise), so the total is rounded to paise.
 */
export function computeOrderAmount(basePriceInr: number): OrderAmount {
  const subtotalInr = basePriceInr;
  const shippingInr = SHIPPING_INR;
  const totalInr = subtotalInr + shippingInr;
  return {
    subtotalInr,
    shippingInr,
    totalInr,
    amountPaise: Math.round(totalInr * 100),
  };
}
