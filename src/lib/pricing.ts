import 'server-only';

/**
 * Server-side order pricing — the single source of truth for what a customer pays.
 * The client NEVER sends an amount; it is always derived here from the product base
 * price (by album size) × copies, plus flat shipping, minus any (server-validated)
 * coupon discount. The discount applies to the SUBTOTAL only — shipping is always
 * charged — and can never push the order below the Razorpay minimum.
 */

/** Flat nationwide shipping, in INR (independent of copies). */
export const SHIPPING_INR = 99;

/** Razorpay's minimum chargeable amount (₹1 = 100 paise). */
export const MIN_CHARGE_INR = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export type OrderAmount = {
  copies: number;
  subtotalInr: number;
  shippingInr: number;
  discountInr: number;
  totalInr: number;
  amountPaise: number; // what Razorpay's Orders API expects
};

/**
 * Compute the order total. `copies` defaults to 1 and `discountInr` to 0, so existing
 * single-copy / no-coupon callers are unaffected.
 *   subtotal = basePrice × copies
 *   discount = clamp(discount, 0..subtotal)        // applies to subtotal only
 *   total    = max(subtotal + shipping − discount, MIN_CHARGE)
 */
export function computeOrderAmount(
  basePriceInr: number,
  copies = 1,
  discountInr = 0,
): OrderAmount {
  const subtotalInr = round2(basePriceInr * copies);
  const shippingInr = SHIPPING_INR;
  const discount = clamp(round2(discountInr), 0, subtotalInr);
  const totalInr = Math.max(round2(subtotalInr + shippingInr - discount), MIN_CHARGE_INR);
  return {
    copies,
    subtotalInr,
    shippingInr,
    discountInr: discount,
    totalInr,
    amountPaise: Math.round(totalInr * 100),
  };
}
