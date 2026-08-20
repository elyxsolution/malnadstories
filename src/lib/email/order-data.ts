import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

/** Everything the order emails need, loaded once via the service role (these run from
 *  the webhook + admin paths, which already operate as trusted backend). */
export type OrderEmailData = {
  orderId: string;
  email: string;
  customerName: string;
  /**
   * LEGACY, first item only — kept so the fulfilment status emails (`order-status.tsx`) keep
   * reading one title exactly as before. For what was actually purchased, use `items`.
   */
  albumTitle: string;
  copies: number;
  /** Every purchased album (Phase 8). One entry for a single-album order. */
  items: { albumTitle: string; copies: number; lineSubtotal: number }[];
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

  const [albumRes, addrRes, profileRes, userRes, couponRes, itemsRes] = await Promise.all([
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
    // The purchased lines (0056) — the authoritative album list for this order.
    svc
      .from('order_items')
      .select('album_title, copies, line_subtotal, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
  ]);

  const album = albumRes.data as { title: string } | null;
  const addr = addrRes.data as
    | { full_name: string; line1: string; city: string; state: string; pincode: string }
    | null;
  const profile = profileRes.data as { name: string | null } | null;
  const coupon = (couponRes.data ?? null) as { code: string } | null;
  const items = (itemsRes.data ?? []) as { album_title: string; copies: number; line_subtotal: string }[];
  const email = userRes.data?.user?.email ?? '';

  return {
    orderId,
    email,
    customerName: profile?.name?.trim() || 'there',
    albumTitle: album?.title ?? 'your album',
    copies: order.copies,
    // Falls back to the legacy single-album shape only if the lines cannot be read, so an email
    // is never sent listing nothing.
    items:
      items.length > 0
        ? items.map((i) => ({
            albumTitle: i.album_title,
            copies: i.copies,
            lineSubtotal: Number(i.line_subtotal),
          }))
        : [
            {
              albumTitle: album?.title ?? 'your album',
              copies: order.copies,
              lineSubtotal: Number(order.subtotal_amount),
            },
          ],
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
