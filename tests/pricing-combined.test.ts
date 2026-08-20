/**
 * COMBINED-ORDER MONEY (Phase 8).
 *
 * Real money, so the arithmetic gets a durable fence. This tests the actual production
 * `computeCombinedOrderAmount` / `computeOrderAmount`; no Razorpay call is made and no order is
 * created — these are the pure functions the server uses to decide what to charge.
 *
 * THE INVARIANTS:
 *   · SHIPPING IS CHARGED ONCE PER ORDER, regardless of how many albums or copies it contains.
 *   · The order subtotal equals the sum of the per-line subtotals it stores — to the paise. The
 *     SQL function `create_order_with_items` re-checks exactly this before inserting, so a drift
 *     here would surface as a refused order rather than a wrong charge, but it must not drift.
 *   · A one-line combined order costs exactly what the single-album path would charge.
 *   · A discount applies to the SUBTOTAL only — it can never eat shipping or go negative.
 */
import { describe, it, expect } from 'vitest';
import { computeOrderAmount, computeCombinedOrderAmount, SHIPPING_INR } from '@/lib/pricing';

const ALPHA = { unitPriceInr: 899, copies: 2 };
const BETA = { unitPriceInr: 1299, copies: 1 };

describe('combined order amount', () => {
  it('charges shipping ONCE for a multi-album order', () => {
    const one = computeCombinedOrderAmount([ALPHA]);
    const two = computeCombinedOrderAmount([ALPHA, BETA]);
    expect(one.shippingInr).toBe(SHIPPING_INR);
    expect(two.shippingInr).toBe(SHIPPING_INR);
    // Adding an album must add exactly that album's subtotal — not a second shipping fee.
    expect(two.totalInr - one.totalInr).toBe(BETA.unitPriceInr * BETA.copies);
  });

  it('keeps the order subtotal exactly equal to the sum of its stored line subtotals', () => {
    const a = computeCombinedOrderAmount([ALPHA, BETA]);
    const sumOfLines = a.lines.reduce((n, l) => n + l.lineSubtotalInr, 0);
    expect(a.subtotalInr).toBe(sumOfLines);
    expect(a.subtotalInr).toBe(3097);
    expect(a.totalInr).toBe(3097 + SHIPPING_INR);
    expect(a.amountPaise).toBe(319600);
  });

  it('reports total copies across every album, which is NOT orders.copies', () => {
    const a = computeCombinedOrderAmount([ALPHA, BETA]);
    expect(a.totalCopies).toBe(3);
    // orders.copies caps at 10 and stores only the FIRST line's copies — never this sum.
    expect(a.totalCopies).not.toBe(a.lines[0].copies);
  });

  it('a one-line combined order equals the single-album path to the paise', () => {
    const single = computeOrderAmount(899, 2);
    const combined = computeCombinedOrderAmount([{ unitPriceInr: 899, copies: 2 }]);
    expect(combined.subtotalInr).toBe(single.subtotalInr);
    expect(combined.totalInr).toBe(single.totalInr);
    expect(combined.amountPaise).toBe(single.amountPaise);
  });

  it('rounds each line before summing, so many lines cannot drift the order total', () => {
    const lines = Array.from({ length: 7 }, () => ({ unitPriceInr: 33.335, copies: 3 }));
    const a = computeCombinedOrderAmount(lines);
    const sumOfLines = a.lines.reduce((n, l) => n + l.lineSubtotalInr, 0);
    expect(a.subtotalInr).toBe(Math.round(sumOfLines * 100) / 100);
    expect(Number.isInteger(a.amountPaise)).toBe(true);
  });

  it('clamps a discount to the subtotal — it can never consume shipping or go negative', () => {
    const huge = computeCombinedOrderAmount([ALPHA, BETA], 999999);
    expect(huge.discountInr).toBe(huge.subtotalInr);
    expect(huge.totalInr).toBeGreaterThan(0);
    // Discount applies to subtotal only, so shipping still stands.
    expect(huge.shippingInr).toBe(SHIPPING_INR);

    const negative = computeCombinedOrderAmount([ALPHA], -50);
    expect(negative.discountInr).toBe(0);
  });

  it('honours a server-resolved shipping tier without multiplying it per album', () => {
    const priority = computeCombinedOrderAmount([ALPHA, BETA], 0, 199);
    expect(priority.shippingInr).toBe(199);
    expect(priority.totalInr).toBe(3097 + 199);
  });
});
