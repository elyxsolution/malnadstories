import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SHIPPING_INR } from '@/lib/pricing';
import OrderStatus from './_status';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default async function OrderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  // RLS scopes the read to the owner; foreign/missing → 404.
  const { data: orderRow } = await supabase
    .from('orders')
    .select('id, status, total_amount, album_id, address_id, razorpay_order_id, placed_at')
    .eq('id', params.id)
    .maybeSingle();
  const order = orderRow as {
    id: string;
    status: string;
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
  const subtotal = total - SHIPPING_INR;

  return (
    <div className="mx-auto max-w-lg p-8">
      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        {' / Order'}
      </p>
      <h1 className="mt-1 text-2xl font-bold">Order {order.id.slice(0, 8)}</h1>
      {album && <p className="mt-1 text-sm text-muted-foreground">{album.title}</p>}

      <div className="mt-6">
        <OrderStatus orderId={order.id} albumId={order.album_id} initialStatus={order.status} />
      </div>

      <section className="mt-6 space-y-2 rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-semibold">Summary</h2>
        <div className="flex justify-between text-muted-foreground">
          <span>Album</span>
          <span>{inr(subtotal)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping</span>
          <span>{inr(SHIPPING_INR)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>Total paid</span>
          <span>{inr(total)}</span>
        </div>
      </section>

      {address && (
        <section className="mt-4 space-y-1 rounded-lg border bg-card p-4 text-sm">
          <h2 className="font-semibold">Delivery address</h2>
          <p>{address.full_name}</p>
          <p className="text-muted-foreground">
            {address.line1}, {address.city}, {address.state} — {address.pincode}
          </p>
        </section>
      )}
    </div>
  );
}
