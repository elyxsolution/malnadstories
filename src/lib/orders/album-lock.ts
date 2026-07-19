import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { PAID_STATES } from '@/lib/orders/status';

type SupabaseServerClient = ReturnType<typeof createClient>;

// Re-exported so existing importers (`@/lib/orders/album-lock`) keep working while the
// definition lives in ONE place (status.ts). The paid family is the full lifecycle:
// paid · processing · printing · packed · shipped · delivered.
export { PAID_STATES };

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
 * PAID_STATES is the canonical paid family (imported from status.ts, re-exported above)
 * so an order in ANY fulfilment state — including printing/packed — freezes the album.
 */

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

/**
 * The album's PAID order itself (id + lifecycle status), or null. Same authoritative
 * source as `hasPaidOrder` (orders.status ∈ PAID_STATES) — use this when the UI needs
 * to *show* the purchase (status card, "View order" link), not just gate on it. RLS
 * scopes the read to the owner. Most recent paid order wins (there is at most one
 * non-terminal order per album, but order history can hold several).
 */
export async function getPaidOrder(
  supabase: SupabaseServerClient,
  albumId: string,
): Promise<{ id: string; status: string; placedAt: string } | null> {
  const { data } = await supabase
    .from('orders')
    .select('id, status, placed_at')
    .eq('album_id', albumId)
    .in('status', PAID_STATES as unknown as string[])
    .order('placed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { id: string; status: string; placed_at: string } | null;
  return row ? { id: row.id, status: row.status, placedAt: row.placed_at } : null;
}

/** DELETE lock: any active order (pending or paid+) exists for the album. */
export function hasActiveOrder(supabase: SupabaseServerClient, albumId: string): Promise<boolean> {
  return existsOrderWithStatus(supabase, albumId, [...PAID_STATES, 'pending']);
}

/**
 * EDIT lock WITH the post-payment review exception (admin review workflow, CHANGE 6/7).
 *
 * A paid album is frozen — EXCEPT when an admin has requested changes on it. When the
 * album's review status is `changes_requested`, editing is REOPENED so the customer can
 * fix the flagged issues and resubmit; every other review status (or no review) keeps a
 * paid album frozen exactly as before. Resubmitting (`submitAlbum`) resets the review to
 * `pending_review`, which re-locks the album automatically on the next write.
 *
 * This is the ONE intentional relaxation of the "paid ⇒ frozen" invariant. Money is still
 * guarded independently by service-role-only writes; this only governs album CONTENT, and
 * only reopens it while an admin is actively asking for changes. Uses the AUTHENTICATED
 * client so RLS scopes both the order check and the album_reviews read to the owner.
 */
export async function isEditingLocked(supabase: SupabaseServerClient, albumId: string): Promise<boolean> {
  if (!(await hasPaidOrder(supabase, albumId))) return false; // not paid → freely editable
  const { data } = await supabase
    .from('album_reviews')
    .select('status')
    .eq('album_id', albumId)
    .maybeSingle();
  const reviewStatus = (data as { status: string } | null)?.status ?? null;
  return reviewStatus !== 'changes_requested'; // paid: locked unless changes were requested
}
