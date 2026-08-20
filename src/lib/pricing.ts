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
 * Compute the order total. `copies` defaults to 1, `discountInr` to 0, and
 * `shippingInr` to the flat SHIPPING_INR — so existing single-copy / no-coupon /
 * standard-shipping callers are unaffected. `shippingInr` is always resolved
 * SERVER-SIDE from the chosen tier (lib/shipping.shippingFeeInr); the client never
 * supplies a shipping amount, only a tier key.
 *   subtotal = basePrice × copies
 *   discount = clamp(discount, 0..subtotal)        // applies to subtotal only
 *   total    = max(subtotal + shipping − discount, MIN_CHARGE)
 */
export function computeOrderAmount(
  basePriceInr: number,
  copies = 1,
  discountInr = 0,
  shippingInr: number = SHIPPING_INR,
): OrderAmount {
  const subtotalInr = round2(basePriceInr * copies);
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

/** One album's contribution to a combined order: its own price × its own copies. */
export type OrderLine = { unitPriceInr: number; copies: number };

export type CombinedOrderAmount = {
  /** Per-line results, in the order supplied — what each `order_items` row will store. */
  lines: { unitPriceInr: number; copies: number; lineSubtotalInr: number }[];
  /** Total copies across every album. Informational: it is NOT `orders.copies` (see 0056). */
  totalCopies: number;
  subtotalInr: number;
  shippingInr: number;
  discountInr: number;
  totalInr: number;
  amountPaise: number;
};

/**
 * Compute a COMBINED order total — several albums, one order, one payment (Phase 8).
 *
 * SHIPPING IS ADDED EXACTLY ONCE, never multiplied by album count or copy count: a combined
 * order is one parcel and one `orders.shipping_amount` (standard ₹99 / priority ₹199 /
 * express ₹399, resolved server-side by `shippingFeeInr`). This mirrors the single-album
 * function, which already charges the tier fee once "independent of copies".
 *
 * Everything else is deliberately identical to `computeOrderAmount` — subtotal-only
 * discount, clamped to the subtotal, the ₹1 Razorpay floor, and paise rounded the same way
 * — so a one-album combined order and a single-album order agree to the rupee. That
 * agreement is what lets the webhook's amount gate (`round(p_amount,2) = total_amount`)
 * stay untouched.
 *
 * `computeOrderAmount` is NOT modified and NOT called here: this function must express
 * multiple base prices, which that signature cannot, and re-implementing the two shared
 * lines is cheaper than making the existing single-album path take a new shape.
 */
export function computeCombinedOrderAmount(
  lines: readonly OrderLine[],
  discountInr = 0,
  shippingInr: number = SHIPPING_INR,
): CombinedOrderAmount {
  const priced = lines.map((l) => ({
    unitPriceInr: round2(l.unitPriceInr),
    copies: l.copies,
    lineSubtotalInr: round2(round2(l.unitPriceInr) * l.copies),
  }));
  // Round each line first, then sum: the same values that are stored per row, so the order's
  // subtotal can never drift from the sum of its lines by a rounding cent.
  const subtotalInr = round2(priced.reduce((sum, l) => sum + l.lineSubtotalInr, 0));
  const discount = clamp(round2(discountInr), 0, subtotalInr);
  const totalInr = Math.max(round2(subtotalInr + shippingInr - discount), MIN_CHARGE_INR);
  return {
    lines: priced,
    totalCopies: priced.reduce((sum, l) => sum + l.copies, 0),
    subtotalInr,
    shippingInr,
    discountInr: discount,
    totalInr,
    amountPaise: Math.round(totalInr * 100),
  };
}
