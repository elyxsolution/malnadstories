'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { CreateTicketSchema, TicketReplySchema } from '@/lib/validations';
import { sendSupportTicketCreatedEmail, sendSupportAdminNewTicketEmail } from '@/lib/email/support-events';
import { checkLimit } from '@/lib/security/guard';

export type SupportActionResult = { ok: true; id: string } | { ok: false; error: string };
export type ReplyActionResult = { ok: true } | { ok: false; error: string };

/**
 * Open a support ticket for the signed-in customer.
 *
 * Authenticated client + RLS: customer_id is taken from the verified JWT (never input),
 * and the support_tickets INSERT policy (0028) re-checks ownership of any linked album /
 * order at the DB level. status is forced to 'open'; the description is the opening post.
 * Audit ('support.ticket_created') is written by the DB trigger.
 */
export async function createTicket(input: unknown): Promise<SupportActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Anti-spam throttle (Phase 10C): per-user, generous.
  const limit = await checkLimit(`ticket:${user.id}`, 5, 10 * 60_000, {
    surface: 'create_ticket',
    actor: { userId: user.id },
  });
  if (!limit.ok) return { ok: false, error: 'You are creating requests too quickly. Please wait a moment.' };

  const parsed = CreateTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const t = parsed.data;

  // Belt-and-braces ownership check for linked records (RLS WITH CHECK also enforces
  // this; a clean app error is friendlier than a 42501 from the policy).
  if (t.albumId) {
    const { data: album } = await supabase.from('albums').select('id').eq('id', t.albumId).maybeSingle();
    if (!album) return { ok: false, error: 'That album could not be found.' };
  }
  if (t.orderId) {
    const { data: order } = await supabase.from('orders').select('id').eq('id', t.orderId).maybeSingle();
    if (!order) return { ok: false, error: 'That order could not be found.' };
  }

  const { data, error } = await supabase
    .from('support_tickets')
    .insert({
      customer_id: user.id,
      album_id: t.albumId ?? null,
      order_id: t.orderId ?? null,
      category: t.category,
      priority: t.priority,
      status: 'open',
      subject: t.subject,
      description: t.description,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('createTicket error:', error);
    return { ok: false, error: 'Could not create your request. Please try again.' };
  }

  const id = (data as { id: string }).id;

  // Best-effort notifications (never block the action).
  try {
    await Promise.all([sendSupportTicketCreatedEmail(id), sendSupportAdminNewTicketEmail(id)]);
  } catch (e) {
    console.error('[support] createTicket email error — continuing', String(e));
  }

  revalidatePath('/support');
  return { ok: true, id };
}

/**
 * Post a customer reply on one of the user's own tickets.
 *
 * Authenticated client + RLS: the support_messages INSERT policy enforces sender_type,
 * sender_id = auth.uid(), ticket ownership, and that the ticket is not closed. The DB
 * trigger bumps the ticket (reopening a waiting/resolved one) and writes the audit row.
 */
export async function replyToTicket(input: unknown): Promise<ReplyActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Anti-spam throttle (Phase 10C): per-user, higher than ticket creation (replies are
  // a normal conversational action).
  const limit = await checkLimit(`ticket-reply:${user.id}`, 20, 10 * 60_000, {
    surface: 'reply_ticket',
    actor: { userId: user.id },
  });
  if (!limit.ok) return { ok: false, error: 'You are sending replies too quickly. Please wait a moment.' };

  const parsed = TicketReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ticketId, body } = parsed.data;

  const { error } = await supabase.from('support_messages').insert({
    ticket_id: ticketId,
    sender_type: 'customer',
    sender_id: user.id,
    body,
    is_internal: false,
  });

  if (error) {
    // RLS rejection (not owner / closed ticket) surfaces here as a permission error.
    console.error('replyToTicket error:', error);
    return { ok: false, error: 'Could not send your reply. The request may be closed.' };
  }

  revalidatePath(`/support/${ticketId}`);
  revalidatePath('/support');
  return { ok: true };
}
