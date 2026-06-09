import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { computeOrderAmount } from '@/lib/pricing';
import Checkout from './_checkout';
import { type Address } from './_address-picker';

// Full paid family — a paid/processing/printing/packed/shipped/delivered order means
// the album is purchased; send the user to the order page (purchased albums stay locked).
const PAID_STATES = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'];

export default async function CheckoutPage({ params }: { params: { albumId: string } }) {
  const supabase = createClient();

  // Album must exist + belong to the user (RLS). Must be submitted to check out.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, title, size, status')
    .eq('id', params.albumId)
    .maybeSingle();
  const album = albumRow as { id: string; title: string; size: number; status: string } | null;
  if (!album) notFound();

  // Orders already on this album: a paid+ one → straight to its confirmation; a pending
  // one → resume with its EXACT figures (copies/coupon) so the UI matches what will be
  // charged on resume.
  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, status, copies, coupon_id, subtotal_amount, shipping_amount, discount_amount, total_amount')
    .eq('album_id', album.id)
    .order('placed_at', { ascending: false });
  const orders = (orderRows ?? []) as {
    id: string;
    status: string;
    copies: number;
    coupon_id: string | null;
    subtotal_amount: string;
    shipping_amount: string;
    discount_amount: string;
    total_amount: string;
  }[];

  const paid = orders.find((o) => PAID_STATES.includes(o.status));
  if (paid) redirect(`/orders/${paid.id}`);

  if (album.status !== 'submitted') redirect(`/albums/${album.id}/build`);

  const pending = orders.find((o) => o.status === 'pending') ?? null;

  // Server-side price from the album's product (RLS allows active-product SELECT).
  const { data: products } = await supabase
    .from('products')
    .select('base_price')
    .eq('pages', album.size)
    .eq('is_active', true)
    .limit(1);
  const product = ((products ?? []) as { base_price: string }[])[0];
  if (!product) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm text-destructive">
        Pricing for this album size is currently unavailable. Please contact support.
      </div>
    );
  }

  // Initial breakdown/copies/coupon: resume a pending order's stored figures, else the
  // default single-copy, no-coupon price. All server-computed.
  let initialCopies = 1;
  let initialCouponCode: string | null = null;
  let amount: { subtotalInr: number; shippingInr: number; discountInr: number; totalInr: number };

  if (pending) {
    initialCopies = pending.copies;
    amount = {
      subtotalInr: Number(pending.subtotal_amount),
      shippingInr: Number(pending.shipping_amount),
      discountInr: Number(pending.discount_amount),
      totalInr: Number(pending.total_amount),
    };
    if (pending.coupon_id) {
      // coupons are service-only; read just the code for display (ownership already
      // proven by the RLS-scoped orders read above).
      const admin = createServiceClient();
      const { data: c } = await admin
        .from('coupons')
        .select('code')
        .eq('id', pending.coupon_id)
        .maybeSingle();
      initialCouponCode = (c as { code: string } | null)?.code ?? null;
    }
  } else {
    const a = computeOrderAmount(Number(product.base_price));
    amount = {
      subtotalInr: a.subtotalInr,
      shippingInr: a.shippingInr,
      discountInr: a.discountInr,
      totalInr: a.totalInr,
    };
  }

  const { data: addressRows } = await supabase
    .from('addresses')
    .select('id, full_name, line1, city, state, pincode, is_default')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  const addresses = (addressRows ?? []) as Address[];

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <p className="mt-1 text-sm text-muted-foreground">{album.title}</p>

      <div className="mt-6">
        <Checkout
          albumId={album.id}
          albumTitle={album.title}
          amount={amount}
          addresses={addresses}
          pendingOrderId={pending?.id ?? null}
          initialCopies={initialCopies}
          initialCouponCode={initialCouponCode}
        />
      </div>
    </div>
  );
}
