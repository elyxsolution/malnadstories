import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { computeOrderAmount } from '@/lib/pricing';
import Checkout from './_checkout';
import { type Address } from './_address-picker';

const PAID_STATES = ['paid', 'processing', 'shipped', 'delivered'];

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

  // Orders already on this album: a paid+ one → straight to its confirmation; a
  // pending one → resume (passed to the client so it can also be cancelled).
  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, status')
    .eq('album_id', album.id)
    .order('placed_at', { ascending: false });
  const orders = (orderRows ?? []) as { id: string; status: string }[];

  const paid = orders.find((o) => PAID_STATES.includes(o.status));
  if (paid) redirect(`/orders/${paid.id}`);

  if (album.status !== 'submitted') redirect(`/albums/${album.id}/build`);

  const pendingOrderId = orders.find((o) => o.status === 'pending')?.id ?? null;

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
  const amount = computeOrderAmount(Number(product.base_price));

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
          amount={{
            subtotalInr: amount.subtotalInr,
            shippingInr: amount.shippingInr,
            totalInr: amount.totalInr,
          }}
          addresses={addresses}
          pendingOrderId={pendingOrderId}
        />
      </div>
    </div>
  );
}
