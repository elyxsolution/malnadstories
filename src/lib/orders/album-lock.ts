import 'server-only';
import type { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = ReturnType<typeof createClient>;

/**
 * Order-commit locks — the user-data integrity layer that keeps an album's content
 * consistent with a placed order. (Money is guarded separately by service-role-only
 * writes; these helpers protect the album's pages/photos.)
 *
 * Two distinct lock levels, because album `size` is fixed at creation and is what
 * drives the price — so editing pages/photos while an order is merely *pending*
 * cannot desync the Razorpay amount, and only a real payment should freeze content:
 *
 *   - hasPaidOrder  → EDIT lock. True once an order is paid or further along.
 *   - hasActiveOrder→ DELETE lock. True for any non-failed/non-cancelled order
 *                     (incl. pending) — a live Razorpay order someone might still
 *                     pay. The cancelOrder escape clears a pending one.
 *
 * Both take the AUTHENTICATED Supabase client so RLS scopes the check to the owner.
 */

const PAID_STATES = ['paid', 'processing', 'shipped', 'delivered'] as const;

async function existsOrderWithStatus(
  supabase: SupabaseServerClient,
  albumId: string,
  statuses: readonly string[],
): Promise<boolean> {
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('album_id', albumId)
    .in('status', statuses as string[])
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** EDIT lock: the album is committed to a paid (or further) order. */
export function hasPaidOrder(supabase: SupabaseServerClient, albumId: string): Promise<boolean> {
  return existsOrderWithStatus(supabase, albumId, PAID_STATES);
}

/** DELETE lock: any active order (pending or paid+) exists for the album. */
export function hasActiveOrder(supabase: SupabaseServerClient, albumId: string): Promise<boolean> {
  return existsOrderWithStatus(supabase, albumId, [...PAID_STATES, 'pending']);
}
