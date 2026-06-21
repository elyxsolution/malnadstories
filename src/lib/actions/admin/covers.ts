'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { presignPut, deleteObject, ALLOWED_CONTENT_TYPES } from '@/lib/r2';
import { enqueueCoverThumbnail } from '@/lib/queue';
import {
  CoverPresignSchema,
  CreateCoverSchema,
  SetCoverActiveSchema,
  DeleteCoverSchema,
} from '@/lib/validations';

export type CoverActionResult = { ok: true } | { ok: false; error: string };
const KEY_PREFIX = 'cover-templates/';

/**
 * Admin-only cover management. Authorization is enforced HERE (requireAdmin) and writes
 * go through the service role — authenticated/anon have no write GRANT on cover_templates.
 * Each mutation writes an audit row (entity_type 'cover') via log_audit in one call.
 * Cover artwork lives in the private R2 bucket under cover-templates/…; never public.
 */

/** Mint a presigned PUT so the admin's browser uploads cover artwork straight to R2. */
export async function presignCoverUpload(
  input: unknown,
): Promise<{ ok: true; uploadUrl: string; key: string } | { ok: false; error: string }> {
  try {
    await requireCapability('cover:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverPresignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { contentType, size } = parsed.data;

  const ext = ALLOWED_CONTENT_TYPES[contentType];
  const key = `${KEY_PREFIX}${randomUUID()}.${ext}`;
  try {
    const uploadUrl = await presignPut({ key, contentType, contentLength: size });
    return { ok: true, uploadUrl, key };
  } catch (e) {
    console.error('[admin] presignCoverUpload error', e);
    return { ok: false, error: 'Could not start the upload.' };
  }
}

/** Register an uploaded cover (after the browser PUT succeeds). */
export async function createCover(input: unknown): Promise<CoverActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('cover:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CreateCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { name, description, imageKey, sort } = parsed.data;

  // Pin the key to our prefix so a forged value can't register an arbitrary object.
  if (!imageKey.startsWith(KEY_PREFIX)) return { ok: false, error: 'Invalid image reference.' };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cover_templates')
    .insert({ name, description: description ?? null, image_key: imageKey, sort, active: true, created_by: actor.userId })
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] createCover error', error);
    return { ok: false, error: 'Could not save the cover.' };
  }
  const coverId = (data as { id: string }).id;

  // Generate the thumbnail + record dimensions off the request (worker + sharp).
  // Best-effort: if enqueue fails, pickers fall back to the master image.
  try {
    await enqueueCoverThumbnail(coverId);
  } catch (e) {
    console.error('[admin] enqueue cover-thumbnail failed (non-fatal):', e);
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'cover.created',
    p_entity_type: 'cover',
    p_entity_id: coverId,
    p_metadata: { name, image_key: imageKey },
  });

  revalidatePath('/admin/covers');
  return { ok: true };
}

/** Show/hide a cover in the customer picker. */
export async function setCoverActive(input: unknown): Promise<CoverActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('cover:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = SetCoverActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { coverTemplateId, active } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cover_templates')
    .update({ active })
    .eq('id', coverTemplateId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] setCoverActive error', error);
    return { ok: false, error: 'Could not update the cover.' };
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: active ? 'cover.enabled' : 'cover.disabled',
    p_entity_type: 'cover',
    p_entity_id: coverTemplateId,
    p_metadata: { active },
  });

  revalidatePath('/admin/covers');
  return { ok: true };
}

export type DeleteCoverResult =
  | { ok: true; mode: 'hard' | 'soft'; usedBy: number }
  | { ok: false; error: string };

/**
 * Safe cover deletion (Part 5).
 *
 *   Referenced by ≥1 album → NEVER physically delete. Set active = false (soft delete):
 *     the row + artwork stay intact, so existing albums and their already-generated /
 *     purchased PDFs keep rendering (the print route resolves a cover by id regardless
 *     of `active`), while the active-filtered pickers stop NEW albums from selecting it.
 *
 *   Unused → true hard delete + R2 cleanup (image + thumbnail). album rows are unaffected.
 *
 * The usage count is read under the service role just before acting; a rare race (an
 * album selecting the cover between the count and the delete) is bounded by the FK's
 * ON DELETE SET NULL, but soft-delete is the default whenever any reference exists.
 */
export async function deleteCover(input: unknown): Promise<DeleteCoverResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('cover:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = DeleteCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { coverTemplateId } = parsed.data;

  const svc = createServiceClient();

  // How many albums reference this cover?
  const { count, error: countErr } = await svc
    .from('albums')
    .select('id', { count: 'exact', head: true })
    .eq('cover_template_id', coverTemplateId);
  if (countErr) {
    console.error('[admin] deleteCover usage-count error', countErr);
    return { ok: false, error: 'Could not check whether the cover is in use.' };
  }
  const usedBy = count ?? 0;

  if (usedBy > 0) {
    // Soft delete — deactivate, keep everything intact.
    const { error } = await svc.from('cover_templates').update({ active: false }).eq('id', coverTemplateId);
    if (error) {
      console.error('[admin] deleteCover soft error', error);
      return { ok: false, error: 'Could not deactivate the cover.' };
    }
    await svc.rpc('log_audit', {
      p_actor_id: actor.userId,
      p_actor_type: 'admin',
      p_action: 'cover.deactivated',
      p_entity_type: 'cover',
      p_entity_id: coverTemplateId,
      p_metadata: { reason: 'delete_blocked_in_use', used_by: usedBy },
    });
    revalidatePath('/admin/covers');
    return { ok: true, mode: 'soft', usedBy };
  }

  // Unused — hard delete + R2 cleanup.
  const { data: row } = await svc
    .from('cover_templates')
    .select('image_key, thumb_key')
    .eq('id', coverTemplateId)
    .maybeSingle();

  const { error } = await svc.from('cover_templates').delete().eq('id', coverTemplateId);
  if (error) {
    console.error('[admin] deleteCover hard error', error);
    return { ok: false, error: 'Could not delete the cover.' };
  }

  const keys = [row?.image_key, row?.thumb_key].filter(Boolean) as string[];
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'cover.deleted',
    p_entity_type: 'cover',
    p_entity_id: coverTemplateId,
    p_metadata: {},
  });

  revalidatePath('/admin/covers');
  return { ok: true, mode: 'hard', usedBy: 0 };
}
