'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { AdminReviewDecisionSchema, AdminReviewNoteSchema } from '@/lib/validations';
import { sendReviewStatusEmail } from '@/lib/email/review-events';

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const RESULT_ERRORS: Record<string, string> = {
  review_not_found: 'Review not found.',
  invalid_status: 'That status is not allowed.',
  invalid_transition: 'That status change is not allowed from the current state.',
  note_required: 'Describe the changes to request before sending.',
  invalid_note: 'Note cannot be empty.',
};

/**
 * Approve / request changes / reject an album review (audited RPC). Authorization is
 * enforced here (requireAdmin); the forward-only state machine + audit live in the DB
 * function. RECORDS THE REVIEW DECISION ONLY — no payment, PDF, or fulfilment side effects.
 * The customer is emailed on the decision (best-effort).
 */
export async function setAlbumReviewStatus(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('review:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminReviewDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { reviewId, status, notes } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_set_album_review', {
    p_review_id: reviewId,
    p_actor_id: actor.userId,
    p_status: status,
    p_notes: notes ?? null,
  });
  if (error) {
    console.error('[admin] set album review status rpc error', error);
    return { ok: false, error: 'Could not update the review.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not update the review.' };

  // Resolve the album for the customer email (the RPC keys on review id; emails key on album).
  const { data: row } = await svc.from('album_reviews').select('album_id').eq('id', reviewId).maybeSingle();
  const albumId = (row as { album_id: string } | null)?.album_id ?? null;
  if (albumId) {
    try {
      await sendReviewStatusEmail(albumId, status);
    } catch (e) {
      console.error('[admin] review status email error — continuing', { reviewId, status, error: String(e) });
    }
  }

  revalidatePath(`/admin/reviews/${reviewId}`);
  revalidatePath('/admin/reviews');
  return { ok: true };
}

/** Append/overwrite the customer-visible reviewer note (audited RPC). Not emailed. */
export async function addAlbumReviewNote(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('review:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AdminReviewNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { reviewId, note } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_add_review_note', {
    p_review_id: reviewId,
    p_actor_id: actor.userId,
    p_note: note,
  });
  if (error) {
    console.error('[admin] add album review note rpc error', error);
    return { ok: false, error: 'Could not add the note.' };
  }
  if (data !== 'ok') return { ok: false, error: RESULT_ERRORS[data as string] ?? 'Could not add the note.' };

  revalidatePath(`/admin/reviews/${reviewId}`);
  return { ok: true };
}
