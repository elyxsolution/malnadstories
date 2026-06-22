'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { CreateRefundSchema, CreateReprintSchema } from '@/lib/validations';
import {
  REFUND_ELIGIBLE_ORDER_STATUSES,
  REPRINT_ELIGIBLE_ORDER_STATUSES,
  ACTIVE_REQUEST_STATUSES,
} from '@/lib/resolutions/model';
import { sendResolutionStatusEmail, sendResolutionAdminNewEmail } from '@/lib/email/resolution-events';
import { checkLimit } from '@/lib/security/guard';

export type ResolutionActionResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * File a refund request for one of the customer's OWN, paid-family orders.
 *
 * Records a decision request only — this NEVER calls Razorpay or changes orders/payments.
 * Authenticated client + RLS: customer_id comes from the JWT (column-scoped INSERT means
 * status/admin_notes/resolved_* can't be set by the client); the RLS WITH CHECK re-verifies
 * order ownership + eligibility + linked-ticket ownership. The partial unique index is the
 * hard backstop against duplicate active requests; we pre-check for a friendly message.
 * Audit ('refund.request_created') is written by the DB trigger.
 */
export async function createRefundRequest(input: unknown): Promise<ResolutionActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Anti-spam throttle (Phase 10C): per-user. The one-active-request-per-order index is
  // the real backstop; this caps churn across orders.
  const limit = await checkLimit(`refund:${user.id}`, 5, 60 * 60_000, {
    surface: 'create_refund',
    actor: { userId: user.id },
  });
  if (!limit.ok) return { ok: false, error: 'You are submitting requests too quickly. Please wait a while.' };

  const parsed = CreateRefundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const r = parsed.data;

  // Ownership + eligibility (RLS-scoped read; mirrors the WITH CHECK for a clean error).
  const { data: order } = await supabase.from('orders').select('status').eq('id', r.orderId).maybeSingle();
  if (!order) return { ok: false, error: 'That order could not be found.' };
  if (!(REFUND_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes((order as { status: string }).status)) {
    return { ok: false, error: 'Refunds can only be requested for a paid order.' };
  }

  if (r.supportTicketId) {
    const { data: ticket } = await supabase.from('support_tickets').select('id').eq('id', r.supportTicketId).maybeSingle();
    if (!ticket) return { ok: false, error: 'That support ticket could not be found.' };
  }

  // One active refund per order.
  const { data: dupe } = await supabase
    .from('refund_requests')
    .select('id')
    .eq('order_id', r.orderId)
    .in('status', ACTIVE_REQUEST_STATUSES as unknown as string[])
    .maybeSingle();
  if (dupe) return { ok: false, error: 'You already have an open refund request for this order.' };

  const { data, error } = await supabase
    .from('refund_requests')
    .insert({
      customer_id: user.id,
      order_id: r.orderId,
      support_ticket_id: r.supportTicketId ?? null,
      reason: r.reason,
      description: r.description,
    })
    .select('id')
    .single();

  if (error || !data) {
    // 23505 → the unique index caught a race; treat as a duplicate.
    if ((error as { code?: string } | null)?.code === '23505') {
      return { ok: false, error: 'You already have an open refund request for this order.' };
    }
    console.error('createRefundRequest error:', error);
    return { ok: false, error: 'Could not submit your request. Please try again.' };
  }

  const id = (data as { id: string }).id;
  try {
    await Promise.all([sendResolutionStatusEmail('refund', id, 'pending'), sendResolutionAdminNewEmail('refund', id)]);
  } catch (e) {
    console.error('[resolutions] refund email error — continuing', String(e));
  }

  revalidatePath('/support/requests');
  return { ok: true, id };
}

/**
 * File a reprint request for one of the customer's OWN, DELIVERED orders. Records a
 * request only — never touches the PDF/print pipeline automatically.
 */
export async function createReprintRequest(input: unknown): Promise<ResolutionActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Anti-spam throttle (Phase 10C): per-user (see createRefundRequest).
  const limit = await checkLimit(`reprint:${user.id}`, 5, 60 * 60_000, {
    surface: 'create_reprint',
    actor: { userId: user.id },
  });
  if (!limit.ok) return { ok: false, error: 'You are submitting requests too quickly. Please wait a while.' };

  const parsed = CreateReprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const r = parsed.data;

  const { data: order } = await supabase.from('orders').select('status').eq('id', r.orderId).maybeSingle();
  if (!order) return { ok: false, error: 'That order could not be found.' };
  if (!(REPRINT_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes((order as { status: string }).status)) {
    return { ok: false, error: 'Reprints can only be requested for a delivered order.' };
  }

  if (r.supportTicketId) {
    const { data: ticket } = await supabase.from('support_tickets').select('id').eq('id', r.supportTicketId).maybeSingle();
    if (!ticket) return { ok: false, error: 'That support ticket could not be found.' };
  }

  const { data: dupe } = await supabase
    .from('reprint_requests')
    .select('id')
    .eq('order_id', r.orderId)
    .in('status', ACTIVE_REQUEST_STATUSES as unknown as string[])
    .maybeSingle();
  if (dupe) return { ok: false, error: 'You already have an open reprint request for this order.' };

  const { data, error } = await supabase
    .from('reprint_requests')
    .insert({
      customer_id: user.id,
      order_id: r.orderId,
      support_ticket_id: r.supportTicketId ?? null,
      issue_type: r.issueType,
      description: r.description,
    })
    .select('id')
    .single();

  if (error || !data) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return { ok: false, error: 'You already have an open reprint request for this order.' };
    }
    console.error('createReprintRequest error:', error);
    return { ok: false, error: 'Could not submit your request. Please try again.' };
  }

  const id = (data as { id: string }).id;
  try {
    await Promise.all([sendResolutionStatusEmail('reprint', id, 'pending'), sendResolutionAdminNewEmail('reprint', id)]);
  } catch (e) {
    console.error('[resolutions] reprint email error — continuing', String(e));
  }

  revalidatePath('/support/requests');
  return { ok: true, id };
}
