'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/auth/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { presignPut, deleteObject, ALLOWED_CONTENT_TYPES } from '@/lib/r2';
import {
  StickerPresignSchema,
  CreateStickerSchema,
  RenameStickerSchema,
  SetStickerActiveSchema,
  DeleteStickerSchema,
  CreateStickerCategorySchema,
} from '@/lib/validations';

export type StickerActionResult = { ok: true } | { ok: false; error: string };
const KEY_PREFIX = 'stickers/';

/**
 * Admin-only sticker management. Authorization is enforced HERE (requireCapability) and writes go
 * through the service role — anon/authenticated have no write GRANT on stickers/sticker_categories.
 * Each mutation writes an audit row (entity_type 'sticker') via log_audit. Sticker artwork lives
 * in the PRIVATE R2 bucket under stickers/…; never public. Mirrors lib/actions/admin/covers.ts.
 */

/** Mint a presigned PUT so the admin's browser uploads sticker artwork straight to R2. */
export async function presignStickerUpload(
  input: unknown,
): Promise<{ ok: true; uploadUrl: string; key: string } | { ok: false; error: string }> {
  try {
    await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = StickerPresignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { contentType, size } = parsed.data;

  const ext = ALLOWED_CONTENT_TYPES[contentType];
  const key = `${KEY_PREFIX}${randomUUID()}.${ext}`;
  try {
    const uploadUrl = await presignPut({ key, contentType, contentLength: size });
    return { ok: true, uploadUrl, key };
  } catch (e) {
    console.error('[admin] presignStickerUpload error', e);
    return { ok: false, error: 'Could not start the upload.' };
  }
}

/** Register an uploaded sticker (after the browser PUT succeeds). */
export async function createSticker(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CreateStickerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { name, categoryId, imageKey, sort } = parsed.data;

  // Pin the key to our prefix so a forged value can't register an arbitrary object.
  if (!imageKey.startsWith(KEY_PREFIX)) return { ok: false, error: 'Invalid image reference.' };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('stickers')
    .insert({ name, category_id: categoryId ?? null, image_key: imageKey, sort, active: true, created_by: actor.userId })
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] createSticker error', error);
    return { ok: false, error: 'Could not save the sticker.' };
  }
  const stickerId = (data as { id: string }).id;

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.created',
    p_entity_type: 'sticker',
    p_entity_id: stickerId,
    p_metadata: { name, image_key: imageKey },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Rename / recategorize a sticker. */
export async function renameSticker(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = RenameStickerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { stickerId, name, categoryId } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('stickers')
    .update({ name, category_id: categoryId ?? null })
    .eq('id', stickerId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] renameSticker error', error);
    return { ok: false, error: 'Could not update the sticker.' };
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.updated',
    p_entity_type: 'sticker',
    p_entity_id: stickerId,
    p_metadata: { name, category_id: categoryId ?? null },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Show/hide a sticker in the customer picker. */
export async function setStickerActive(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = SetStickerActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { stickerId, active } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.from('stickers').update({ active }).eq('id', stickerId).select('id').maybeSingle();
  if (error || !data) {
    console.error('[admin] setStickerActive error', error);
    return { ok: false, error: 'Could not update the sticker.' };
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: active ? 'sticker.enabled' : 'sticker.disabled',
    p_entity_type: 'sticker',
    p_entity_id: stickerId,
    p_metadata: { active },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/**
 * Delete a sticker. Unlike covers, a placed sticker stores only its id in album jsonb (no FK), so
 * a hard delete won't break referential integrity — a since-deleted sticker simply stops rendering
 * (same as a missing photo). We still hard-delete + clean up R2; deactivate instead if you want to
 * keep existing placements rendering.
 */
export async function deleteSticker(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = DeleteStickerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { stickerId } = parsed.data;

  const svc = createServiceClient();
  const { data: row } = await svc.from('stickers').select('image_key, thumb_key').eq('id', stickerId).maybeSingle();

  const { error } = await svc.from('stickers').delete().eq('id', stickerId);
  if (error) {
    console.error('[admin] deleteSticker error', error);
    return { ok: false, error: 'Could not delete the sticker.' };
  }

  const keys = [
    (row as { image_key?: string; thumb_key?: string } | null)?.image_key,
    (row as { image_key?: string; thumb_key?: string } | null)?.thumb_key,
  ].filter(Boolean) as string[];
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.deleted',
    p_entity_type: 'sticker',
    p_entity_id: stickerId,
    p_metadata: {},
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Add a sticker category. */
export async function createStickerCategory(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CreateStickerCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { name } = parsed.data;

  // Deterministic slug from the name; uniqueness is enforced by the DB (slug unique).
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cat-${Date.now().toString(36)}`;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('sticker_categories')
    .insert({ name, slug })
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] createStickerCategory error', error);
    return { ok: false, error: 'Could not create the category (the name may already exist).' };
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker_category.created',
    p_entity_type: 'sticker',
    p_entity_id: (data as { id: string }).id,
    p_metadata: { name, slug },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}
