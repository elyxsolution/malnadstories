'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { AdminTicketReplySchema, AdminTicketStatusSchema, AdminTicketAssignSchema } from '@/lib/validations';
import { sendSupportReplyEmail, sendSupportResolvedEmail } from '@/lib/email/support-events';

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const RESULT_ERRORS: Record<string, string> = {
  ticket_not_found: 'Ticket not found.',
  invalid_status: 'That status is not allowed.',
};

/**
 * Post an admin reply (or internal note) on a ticket. Authorization is enforced HERE
 * (requireAdmin); the insert goes via the service role (the message-insert trigger
 * bumps the ticket + writes the audit row atomically, with the admin as the actor).
 * A public reply emails the customer (best-effort).
 */
export async function adminReplyTicket(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('support:reply');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminTicketReplySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ticketId, body, internal } = parsed.data;

  const svc = createServiceClient();
  // Confirm the ticket exists (cleaner error than a silent FK failure).
  const { data: ticket } = await svc.from('support_tickets').select('id').eq('id', ticketId).maybeSingle();
  if (!ticket) return { ok: false, error: RESULT_ERRORS.ticket_not_found };

  const { error } = await svc.from('support_messages').insert({
    ticket_id: ticketId,
    sender_type: 'admin',
    sender_id: actor.userId,
    body,
    is_internal: internal,
  });
  if (error) {
    console.error('[admin] adminReplyTicket insert error', error);
    return { ok: false, error: 'Could not post the reply.' };
  }

  // Notify the customer only for public replies.
  if (!internal) {
    try {
      await sendSupportReplyEmail(ticketId);
    } catch (e) {
      console.error('[admin] support reply email error — continuing', { ticketId, error: String(e) });
    }
  }

  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath('/admin/support');
  return { ok: true };
}

/** Change a ticket's status (audited RPC). 'resolved' emails the customer. */
export async function setTicketStatus(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('support:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminTicketStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ticketId, status } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_set_support_status', {
    p_ticket_id: ticketId,
    p_actor_id: actor.userId,
    p_status: status,
  });
  if (error) {
    console.error('[admin] setTicketStatus rpc error', error);
    return { ok: false, error: 'Could not update the ticket.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not update the ticket.' };

  if (status === 'resolved') {
    try {
      await sendSupportResolvedEmail(ticketId);
    } catch (e) {
      console.error('[admin] support resolved email error — continuing', { ticketId, error: String(e) });
    }
  }

  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath('/admin/support');
  return { ok: true };
}

/** Assign the ticket to the acting admin, or unassign it (audited RPC). */
export async function assignTicket(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('support:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminTicketAssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ticketId, assign } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_assign_support_ticket', {
    p_ticket_id: ticketId,
    p_actor_id: actor.userId,
    // Assign to the acting admin, or unassign — the assignee is never client-supplied.
    p_assignee: assign ? actor.userId : null,
  });
  if (error) {
    console.error('[admin] assignTicket rpc error', error);
    return { ok: false, error: 'Could not assign the ticket.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not assign the ticket.' };

  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath('/admin/support');
  return { ok: true };
}
