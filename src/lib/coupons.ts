import 'server-only';
import { randomInt } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Coupon validation + discount math + code generation. All server-only.
 *
 * Coupons are read with the SERVICE-ROLE client (the authenticated role has no read
 * access — codes must not be enumerable). Validation NEVER consumes a coupon; that
 * happens once, on payment success, inside process_razorpay_event (0017).
 */

export type CouponRow = {
  id: string;
  code: string;
  discount_type: 'flat' | 'percentage';
  discount_value: string;
  minimum_order_amount: string | null;
  max_uses: number | null;
  current_uses: number;
  starts_at: string;
  expires_at: string | null;
  active: boolean;
};

export type CouponFailCode =
  | 'coupon_not_found'
  | 'coupon_inactive'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_exhausted'
  | 'coupon_min_not_met';

export type CouponValidation =
  | { ok: true; coupon: CouponRow; discountInr: number }
  | { ok: false; code: CouponFailCode; message: string };

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: discount applies to SUBTOTAL only and never exceeds it. */
export function computeDiscount(
  type: 'flat' | 'percentage',
  value: number,
  subtotalInr: number,
): number {
  const raw = type === 'flat' ? value : (subtotalInr * value) / 100;
  return Math.min(round2(raw), subtotalInr);
}

/**
 * Validate a coupon code against an order SUBTOTAL. Returns the computed discount on
 * success, or a precise failure code + message. The usable predicate is the single
 * source of truth (Refinements 1+2): active AND started AND not-expired AND
 * under-cap AND meets-minimum.
 */
export async function validateCoupon(
  code: string,
  subtotalInr: number,
): Promise<CouponValidation> {
  const normalized = code.trim().toUpperCase();
  const admin = createServiceClient();
  const { data } = await admin
    .from('coupons')
    .select(
      'id, code, discount_type, discount_value, minimum_order_amount, max_uses, current_uses, starts_at, expires_at, active',
    )
    .eq('code', normalized)
    .maybeSingle();
  const coupon = data as CouponRow | null;

  if (!coupon) return { ok: false, code: 'coupon_not_found', message: 'That coupon code is not valid.' };
  if (!coupon.active) return { ok: false, code: 'coupon_inactive', message: 'This coupon is no longer active.' };

  const now = Date.now();
  if (new Date(coupon.starts_at).getTime() > now) {
    return { ok: false, code: 'coupon_not_started', message: 'This coupon is not active yet.' };
  }
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) {
    return { ok: false, code: 'coupon_expired', message: 'This coupon has expired.' };
  }
  if (coupon.max_uses != null && coupon.current_uses >= coupon.max_uses) {
    return { ok: false, code: 'coupon_exhausted', message: 'This coupon has reached its usage limit.' };
  }
  const min = coupon.minimum_order_amount != null ? Number(coupon.minimum_order_amount) : null;
  if (min != null && subtotalInr < min) {
    return {
      ok: false,
      code: 'coupon_min_not_met',
      message: `This coupon needs a minimum order of ${inr(min)}.`,
    };
  }

  const discountInr = computeDiscount(coupon.discount_type, Number(coupon.discount_value), subtotalInr);
  return { ok: true, coupon, discountInr };
}

// Unambiguous alphabet (no I, O, 0, 1) so codes are easy to read/type aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Generate a code like MS-AB12CD34. Uniqueness is enforced by the DB index; the
 *  caller retries on the rare collision. */
export function generateCouponCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `MS-${s}`;
}
