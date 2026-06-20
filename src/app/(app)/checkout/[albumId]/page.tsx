import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { computeOrderAmount } from '@/lib/pricing';
import { DEFAULT_SHIPPING_METHOD, isShippingMethod, type ShippingMethod } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
import { presignGet } from '@/lib/r2';
import { listActiveCoverOptions } from '@/lib/covers';
import { brandFontVars } from '@/lib/fonts';
import Checkout from './_checkout';
import { type Address } from './_address-picker';

export default async function CheckoutPage({ params }: { params: { albumId: string } }) {
  const supabase = createClient();

  // Album must exist + belong to the user (RLS). Must be submitted to check out.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, title, size, status, cover_template_id, destination, travel_dates')
    .eq('id', params.albumId)
    .maybeSingle();
  const album = albumRow as {
    id: string;
    title: string;
    size: number;
    status: string;
    cover_template_id: string | null;
    destination: string | null;
    travel_dates: string | null;
  } | null;
  if (!album) notFound();

  // Orders already on this album: a paid+ one → straight to its confirmation; a pending
  // one → resume with its EXACT figures (copies/coupon) so the UI matches what will be
  // charged on resume.
  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, status, copies, coupon_id, subtotal_amount, shipping_amount, shipping_method, discount_amount, total_amount')
    .eq('album_id', album.id)
    .order('placed_at', { ascending: false });
  const orders = (orderRows ?? []) as {
    id: string;
    status: string;
    copies: number;
    coupon_id: string | null;
    subtotal_amount: string;
    shipping_amount: string;
    shipping_method: string;
    discount_amount: string;
    total_amount: string;
  }[];

  const paid = orders.find((o) => isPaidStatus(o.status));
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
  let initialShippingMethod: ShippingMethod = DEFAULT_SHIPPING_METHOD;
  let amount: { subtotalInr: number; shippingInr: number; discountInr: number; totalInr: number };

  if (pending) {
    initialCopies = pending.copies;
    if (isShippingMethod(pending.shipping_method)) initialShippingMethod = pending.shipping_method;
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

  // Cover thumbnail for the album-summary preview (what the customer is buying).
  // Mirrors the builder page: resolve from the active covers, with a service-role
  // fallback for a now-inactive cover. Display only — never gates anything.
  let coverUrl: string | null = null;
  let coverName: string | null = null;
  if (album.cover_template_id) {
    const covers = await listActiveCoverOptions();
    const active = covers.find((c) => c.id === album.cover_template_id);
    if (active) {
      coverUrl = active.thumbUrl;
      coverName = active.name;
    } else {
      const svc = createServiceClient();
      const { data: c } = await svc
        .from('cover_templates')
        .select('name, image_key')
        .eq('id', album.cover_template_id)
        .maybeSingle();
      const row = c as { name: string; image_key: string } | null;
      if (row) {
        coverUrl = await presignGet(row.image_key, 3600);
        coverName = row.name;
      }
    }
  }

  return (
    <div className={`${brandFontVars} brand-surface min-h-[calc(100vh-3.5rem)] font-ui`}>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <Link
          href={`/albums/${album.id}/build`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to album
        </Link>
        <h1 className="mt-3 font-display text-[2.1rem] font-semibold leading-none tracking-[-0.01em]">Review &amp; pay</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A few details away from turning <span className="font-medium text-foreground">{album.title}</span> into a printed keepsake.
        </p>
        {(album.destination || album.travel_dates) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {[album.destination, album.travel_dates].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="mt-8">
          <Checkout
            albumId={album.id}
            albumTitle={album.title}
            albumSize={album.size}
            coverUrl={coverUrl}
            coverName={coverName}
            amount={amount}
            addresses={addresses}
            pendingOrderId={pending?.id ?? null}
            initialCopies={initialCopies}
            initialCouponCode={initialCouponCode}
            initialShippingMethod={initialShippingMethod}
          />
        </div>
      </div>
    </div>
  );
}
