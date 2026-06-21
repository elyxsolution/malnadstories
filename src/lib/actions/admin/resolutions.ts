'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { AdminRequestStatusSchema, AdminRequestNoteSchema } from '@/lib/validations';
import { sendResolutionStatusEmail } from '@/lib/email/resolution-events';
import type { ResolutionKind } from '@/lib/email/resolution-data';

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const RESULT_ERRORS: Record<string, string> = {
  request_not_found: 'Request not found.',
  invalid_status: 'That status is not allowed.',
  invalid_transition: 'That status change is not allowed from the current state.',
  invalid_note: 'Note cannot be empty.',
};

const RPC = {
  refund: { status: 'admin_set_refund_status', note: 'admin_add_refund_note' },
  reprint: { status: 'admin_set_reprint_status', note: 'admin_add_reprint_note' },
} as const;

/**
 * Set a refund/reprint request status (audited RPC). Authorization enforced here
 * (requireAdmin); the forward-only state machine + audit live in the DB function. The
 * customer is emailed on approved/rejected/completed (best-effort). RECORDS THE DECISION
 * ONLY — no Razorpay / payment / order-status side effects.
 */
async function setStatus(kind: ResolutionKind, input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability(kind === 'refund' ? 'refund:update' : 'reprint:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminRequestStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { requestId, status, note } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc(RPC[kind].status, {
    p_request_id: requestId,
    p_actor_id: actor.userId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) {
    console.error(`[admin] set ${kind} status rpc error`, error);
    return { ok: false, error: 'Could not update the request.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not update the request.' };

  try {
    await sendResolutionStatusEmail(kind, requestId, status);
  } catch (e) {
    console.error(`[admin] ${kind} status email error — continuing`, { requestId, status, error: String(e) });
  }

  revalidatePath(`/admin/${kind === 'refund' ? 'refunds' : 'reprints'}/${requestId}`);
  revalidatePath(`/admin/${kind === 'refund' ? 'refunds' : 'reprints'}`);
  return { ok: true };
}

/** Append an admin note to a request (audited RPC). Internal — never emailed. */
async function addNote(kind: ResolutionKind, input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability(kind === 'refund' ? 'refund:update' : 'reprint:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminRequestNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { requestId, note } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc(RPC[kind].note, {
    p_request_id: requestId,
    p_actor_id: actor.userId,
    p_note: note,
  });
  if (error) {
    console.error(`[admin] add ${kind} note rpc error`, error);
    return { ok: false, error: 'Could not add the note.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not add the note.' };

  revalidatePath(`/admin/${kind === 'refund' ? 'refunds' : 'reprints'}/${requestId}`);
  return { ok: true };
}

export async function setRefundStatus(input: unknown): Promise<AdminActionResult> {
  return setStatus('refund', input);
}
export async function setReprintStatus(input: unknown): Promise<AdminActionResult> {
  return setStatus('reprint', input);
}
export async function addRefundNote(input: unknown): Promise<AdminActionResult> {
  return addNote('refund', input);
}
export async function addReprintNote(input: unknown): Promise<AdminActionResult> {
  return addNote('reprint', input);
}
