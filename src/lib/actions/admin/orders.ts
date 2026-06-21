'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { UpdateOrderStatusSchema, SetTrackingSchema, AddOrderNoteSchema } from '@/lib/validations';
import { sendOrderStatusEmail } from '@/lib/email/events';

export type AdminActionResult = { ok: true } | { ok: false; error: string };

// RPC result codes → user-facing messages. 'ok' is success; anything else is a
// validation failure the DB enforced (the state machine / tracking guard live there).
const RESULT_ERRORS: Record<string, string> = {
  order_not_found: 'Order not found.',
  invalid_transition: 'That status change is not allowed from the current state.',
  tracking_required: 'Add a tracking number and carrier before marking the order shipped.',
  tracking_duplicate: 'That tracking number is already on another order for this carrier.',
};

/**
 * Advance an order's fulfilment status. Authorization is enforced HERE (requireAdmin)
 * and the forward-only state machine is enforced in the DB (admin_update_order_status,
 * which also writes the audit row atomically). The write goes via the service role —
 * the authenticated client is blocked from orders writes by RLS (0012).
 */
export async function updateOrderStatus(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('order:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = UpdateOrderStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { orderId, status } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_update_order_status', {
    p_order_id: orderId,
    p_new_status: status,
    p_actor_id: actor.userId,
  });
  if (error) {
    console.error('[admin] updateOrderStatus rpc error', error);
    return { ok: false, error: 'Could not update the order.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not update the order.' };

  // The transition is ALREADY committed in the DB (the RPC ran). The fulfilment email
  // is best-effort and must never turn a successful transition into a failed action —
  // sendOrderStatusEmail is itself throw-proof, but we guard here too so nothing after
  // the commit can flip the result.
  try {
    await sendOrderStatusEmail(orderId, status);
  } catch (e) {
    console.error('[admin] status email error — continuing', { orderId, status, error: String(e) });
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { ok: true };
}

/** Set the shipping tracking number + carrier (audited). */
export async function setTracking(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('order:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = SetTrackingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { orderId, trackingNumber, carrier } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_set_tracking', {
    p_order_id: orderId,
    p_tracking: trackingNumber,
    p_carrier: carrier,
    p_actor_id: actor.userId,
  });
  if (error) {
    console.error('[admin] setTracking rpc error', error);
    return { ok: false, error: 'Could not save tracking details.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not save tracking details.' };

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

/** Append an internal note to an order's timeline (audited). */
export async function addOrderNote(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('order:note');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AddOrderNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { orderId, body } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_add_order_note', {
    p_order_id: orderId,
    p_actor_id: actor.userId,
    p_body: body,
  });
  if (error) {
    console.error('[admin] addOrderNote rpc error', error);
    return { ok: false, error: 'Could not add the note.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not add the note.' };

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}
