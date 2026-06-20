import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { shippingLabel } from '@/lib/shipping';
import { brandFontVars } from '@/lib/fonts';
import OrderStatus from './_status';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default async function OrderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  // RLS scopes the read to the owner; foreign/missing → 404.
  const { data: orderRow } = await supabase
    .from('orders')
    .select(
      'id, status, subtotal_amount, shipping_amount, shipping_method, discount_amount, total_amount, album_id, address_id, razorpay_order_id, placed_at',
    )
    .eq('id', params.id)
    .maybeSingle();
  const order = orderRow as {
    id: string;
    status: string;
    subtotal_amount: string;
    shipping_amount: string;
    shipping_method: string;
    discount_amount: string;
    total_amount: string;
    album_id: string;
    address_id: string;
    razorpay_order_id: string | null;
    placed_at: string;
  } | null;
  if (!order) notFound();

  const [{ data: albumRow }, { data: addrRow }] = await Promise.all([
    supabase.from('albums').select('title').eq('id', order.album_id).maybeSingle(),
    supabase
      .from('addresses')
      .select('full_name, line1, city, state, pincode')
      .eq('id', order.address_id)
      .maybeSingle(),
  ]);
  const album = albumRow as { title: string } | null;
  const address = addrRow as
    | { full_name: string; line1: string; city: string; state: string; pincode: string }
    | null;

  const total = Number(order.total_amount);
  const subtotal = Number(order.subtotal_amount);
  const shipping = Number(order.shipping_amount);
  const discount = Number(order.discount_amount);
  const tierLabel = shippingLabel(order.shipping_method);
  const placedDate = new Date(order.placed_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className={`${brandFontVars} brand-surface min-h-[calc(100vh-3.5rem)] font-ui`}>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:py-10">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </Link>

        <div className="mt-5">
          <OrderStatus orderId={order.id} albumId={order.album_id} initialStatus={order.status} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 text-sm shadow-panel">
            <h2 className="font-display text-[15px] font-semibold tracking-tight">Order summary</h2>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-muted-foreground">
                <span>Album</span>
                <span className="tabular-nums text-foreground">{inr(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping · {tierLabel}</span>
                <span className="tabular-nums text-foreground">{inr(shipping)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Discount</span>
                  <span className="tabular-nums">− {inr(discount)}</span>
                </div>
              )}
              <div className="seam my-1" />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Total paid</span>
                <span className="font-display text-xl font-semibold tabular-nums tracking-[-0.01em]">{inr(total)}</span>
              </div>
            </div>
          </section>

          {address && (
            <section className="rounded-2xl border bg-card p-5 text-sm shadow-panel">
              <h2 className="font-display text-[15px] font-semibold tracking-tight">Delivering to</h2>
              <p className="mt-3 font-medium">{address.full_name}</p>
              <p className="mt-0.5 text-muted-foreground">
                {address.line1}, {address.city}, {address.state} — {address.pincode}
              </p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {tierLabel} delivery
              </p>
            </section>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
          <span>
            Order&nbsp;#{order.id.slice(0, 8)}
            {album ? ` · ${album.title}` : ''}
          </span>
          <span>Placed {placedDate}</span>
        </div>
      </div>
    </div>
  );
}
