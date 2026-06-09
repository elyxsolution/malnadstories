import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

/** Everything the order emails need, loaded once via the service role (these run from
 *  the webhook + admin paths, which already operate as trusted backend). */
export type OrderEmailData = {
  orderId: string;
  email: string;
  customerName: string;
  albumTitle: string;
  copies: number;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  couponCode: string | null;
  address: { fullName: string; line1: string; city: string; state: string; pincode: string } | null;
  trackingNumber: string | null;
  carrier: string | null;
};

export async function loadOrderEmailData(orderId: string): Promise<OrderEmailData | null> {
  const svc = createServiceClient();

  const { data: orderRow } = await svc
    .from('orders')
    .select(
      'id, user_id, album_id, address_id, copies, subtotal_amount, shipping_amount, discount_amount, total_amount, coupon_id, tracking_number, carrier',
    )
    .eq('id', orderId)
    .maybeSingle();
  const order = orderRow as {
    user_id: string;
    album_id: string;
    address_id: string;
    copies: number;
    subtotal_amount: string;
    shipping_amount: string;
    discount_amount: string;
    total_amount: string;
    coupon_id: string | null;
    tracking_number: string | null;
    carrier: string | null;
  } | null;
  if (!order) return null;

  const [albumRes, addrRes, profileRes, userRes, couponRes] = await Promise.all([
    svc.from('albums').select('title').eq('id', order.album_id).maybeSingle(),
    svc
      .from('addresses')
      .select('full_name, line1, city, state, pincode')
      .eq('id', order.address_id)
      .maybeSingle(),
    svc.from('profiles').select('name').eq('id', order.user_id).maybeSingle(),
    svc.auth.admin.getUserById(order.user_id),
    order.coupon_id
      ? svc.from('coupons').select('code').eq('id', order.coupon_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const album = albumRes.data as { title: string } | null;
  const addr = addrRes.data as
    | { full_name: string; line1: string; city: string; state: string; pincode: string }
    | null;
  const profile = profileRes.data as { name: string | null } | null;
  const coupon = (couponRes.data ?? null) as { code: string } | null;
  const email = userRes.data?.user?.email ?? '';

  return {
    orderId,
    email,
    customerName: profile?.name?.trim() || 'there',
    albumTitle: album?.title ?? 'your album',
    copies: order.copies,
    subtotal: Number(order.subtotal_amount),
    shipping: Number(order.shipping_amount),
    discount: Number(order.discount_amount),
    total: Number(order.total_amount),
    couponCode: coupon?.code ?? null,
    address: addr
      ? {
          fullName: addr.full_name,
          line1: addr.line1,
          city: addr.city,
          state: addr.state,
          pincode: addr.pincode,
        }
      : null,
    trackingNumber: order.tracking_number,
    carrier: order.carrier,
  };
}
