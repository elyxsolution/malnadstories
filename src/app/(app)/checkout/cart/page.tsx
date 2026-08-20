import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveCartForCheckout } from '@/lib/cart/checkout';
import { computeCombinedOrderAmount } from '@/lib/pricing';
import { DEFAULT_SHIPPING_METHOD, shippingFeeInr } from '@/lib/shipping';
import { brandFontVars } from '@/lib/fonts';
import CombinedCheckout from './_combined-checkout';
import { type Address } from '../[albumId]/_address-picker';

/**
 * COMBINED CHECKOUT (Phase 8) — every album in the cart, one order, one payment.
 *
 * The single-album route `/checkout/[albumId]` is untouched and still handles a one-album
 * purchase (and its readiness panel, its pending-order resume and its own copies stepper).
 * This page exists beside it rather than replacing it.
 *
 * EVERY NUMBER ON THIS PAGE IS SERVER-COMPUTED. `resolveCartForCheckout` reads the customer's
 * own cart, resolves each album and product, prices each line with `priceFor`, and reports any
 * album that cannot be ordered. `computeCombinedOrderAmount` then adds shipping ONCE. The client
 * receives the result to render — and `createCombinedOrder` re-runs exactly the same resolution
 * at pay time, so the browser's copy can never become the basis of a charge.
 */
export default async function CombinedCheckoutPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { lines, blocked } = await resolveCartForCheckout(supabase);

  // Nothing orderable at all → back to the cart, which explains why (its own row states).
  if (lines.length === 0) redirect('/cart');

  const shippingInr = shippingFeeInr(DEFAULT_SHIPPING_METHOD);
  const amount = computeCombinedOrderAmount(
    lines.map((l) => ({ unitPriceInr: l.unitPriceInr, copies: l.copies })),
    0,
    shippingInr,
  );

  // OWN ADDRESSES ONLY — filtered explicitly, not just by RLS. `addresses` carries an
  // `admins_read_all_addresses` policy, so for an admin the RLS-scoped read returns EVERY
  // customer's address; without this filter the picker would list them and could pre-select a
  // foreign one (found by the real browser run — the order was then correctly refused by
  // `create_order_with_items`). Defense in depth, the same "RLS + explicit filter" shape the
  // CMS public read uses.
  const { data: addressRows } = await supabase
    .from('addresses')
    .select('id, full_name, line1, city, state, pincode, is_default')
    .eq('user_id', user?.id ?? '')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  const addresses = (addressRows ?? []) as Address[];

  return (
    <div className={`${brandFontVars} brand-surface`}>
      <CombinedCheckout
        lines={lines.map((l) => ({
          albumId: l.albumId,
          albumTitle: l.albumTitle,
          subtitle: l.subtitle,
          size: l.size,
          copies: l.copies,
          unitPriceInr: l.unitPriceInr,
          lineSubtotalInr: l.lineSubtotalInr,
          productName: l.productName,
          cover: l.cover,
        }))}
        blocked={blocked.map((b) => ({ albumId: b.albumId, albumTitle: b.albumTitle, message: b.message }))}
        amount={{
          subtotalInr: amount.subtotalInr,
          shippingInr: amount.shippingInr,
          discountInr: amount.discountInr,
          totalInr: amount.totalInr,
        }}
        addresses={addresses}
        initialShippingMethod={DEFAULT_SHIPPING_METHOD}
        email={user?.email ?? ''}
      />
    </div>
  );
}
