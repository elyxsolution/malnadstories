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
  ReplaceStickerArtworkSchema,
  ReorderStickersSchema,
  BulkStickerActiveSchema,
  BulkStickerDeleteSchema,
  CreateStickerCategorySchema,
  RenameStickerCategorySchema,
  DeleteStickerCategorySchema,
  ReorderStickerCategoriesSchema,
} from '@/lib/validations';

export type StickerActionResult = { ok: true } | { ok: false; error: string };
const KEY_PREFIX = 'stickers/';

/** Normalise tags: trim, lowercase, drop blanks, de-dupe, cap at 20. */
function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const t of tags ?? []) {
    const v = t.trim().toLowerCase();
    if (v) seen.add(v);
  }
  return Array.from(seen).slice(0, 20);
}

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
  const { stickerId, name, categoryId, tags } = parsed.data;
  const cleanTags = normalizeTags(tags);

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('stickers')
    .update({ name, category_id: categoryId ?? null, tags: cleanTags })
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
    p_metadata: { name, category_id: categoryId ?? null, tags: cleanTags },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/**
 * Replace a sticker's artwork with a freshly-uploaded R2 object (same upload pipeline as create:
 * presignStickerUpload → PUT → this). The stickerId is UNCHANGED, so every album that already
 * placed it now shows the new artwork (placements store only the sticker id). The old objects are
 * deleted after the row is updated. width/height/thumb are reset (stickers have no thumb job).
 */
export async function replaceStickerArtwork(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ReplaceStickerArtworkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { stickerId, imageKey } = parsed.data;
  if (!imageKey.startsWith(KEY_PREFIX)) return { ok: false, error: 'Invalid image reference.' };

  const svc = createServiceClient();
  const { data: prev } = await svc.from('stickers').select('image_key, thumb_key').eq('id', stickerId).maybeSingle();
  const before = prev as { image_key: string; thumb_key: string | null } | null;
  if (!before) return { ok: false, error: 'Sticker not found.' };

  const { error } = await svc
    .from('stickers')
    .update({ image_key: imageKey, thumb_key: null, width: null, height: null })
    .eq('id', stickerId);
  if (error) {
    console.error('[admin] replaceStickerArtwork error', error);
    return { ok: false, error: 'Could not replace the artwork.' };
  }

  // Delete the old objects (best-effort) only after the row points at the new key.
  const stale = [before.image_key, before.thumb_key].filter((k): k is string => !!k && k !== imageKey);
  await Promise.all(stale.map((k) => deleteObject(k).catch(() => {})));

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.artwork_replaced',
    p_entity_type: 'sticker',
    p_entity_id: stickerId,
    p_metadata: { image_key: imageKey },
  });

  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Persist a new display order (array position = sort index). */
export async function reorderStickers(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ReorderStickersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids } = parsed.data;

  const svc = createServiceClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await svc.from('stickers').update({ sort: i }).eq('id', ids[i]);
    if (error) {
      console.error('[admin] reorderStickers error', error);
      return { ok: false, error: 'Could not save the new order.' };
    }
  }
  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.reordered',
    p_entity_type: 'sticker',
    p_entity_id: ids[0],
    p_metadata: { count: ids.length },
  });
  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Bulk enable/disable a selection. */
export async function setStickersActiveBulk(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BulkStickerActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids, active } = parsed.data;

  const svc = createServiceClient();
  const { error } = await svc.from('stickers').update({ active }).in('id', ids);
  if (error) {
    console.error('[admin] setStickersActiveBulk error', error);
    return { ok: false, error: 'Could not update the stickers.' };
  }
  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: active ? 'sticker.bulk_enabled' : 'sticker.bulk_disabled',
    p_entity_type: 'sticker',
    p_entity_id: ids[0],
    p_metadata: { ids, active },
  });
  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Bulk delete a selection (+ R2 cleanup). Placements of a deleted sticker simply stop rendering. */
export async function deleteStickersBulk(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BulkStickerDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids } = parsed.data;

  const svc = createServiceClient();
  const { data: rows } = await svc.from('stickers').select('image_key, thumb_key').in('id', ids);

  const { error } = await svc.from('stickers').delete().in('id', ids);
  if (error) {
    console.error('[admin] deleteStickersBulk error', error);
    return { ok: false, error: 'Could not delete the stickers.' };
  }

  const keys = ((rows ?? []) as { image_key?: string; thumb_key?: string }[])
    .flatMap((r) => [r.image_key, r.thumb_key])
    .filter((k): k is string => !!k);
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker.bulk_deleted',
    p_entity_type: 'sticker',
    p_entity_id: ids[0],
    p_metadata: { count: ids.length },
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

/** Rename a category (slug is left stable so existing links/filters don't shift). */
export async function renameStickerCategory(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = RenameStickerCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { categoryId, name } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.from('sticker_categories').update({ name }).eq('id', categoryId).select('id').maybeSingle();
  if (error || !data) {
    console.error('[admin] renameStickerCategory error', error);
    return { ok: false, error: 'Could not rename the category.' };
  }
  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker_category.updated',
    p_entity_type: 'sticker',
    p_entity_id: categoryId,
    p_metadata: { name },
  });
  revalidatePath('/admin/stickers');
  return { ok: true };
}

/**
 * Delete a category. stickers.category_id is ON DELETE SET NULL (0039), so member stickers become
 * "Uncategorized" rather than being deleted — no artwork is lost.
 */
export async function deleteStickerCategory(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = DeleteStickerCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { categoryId } = parsed.data;

  const svc = createServiceClient();
  const { error } = await svc.from('sticker_categories').delete().eq('id', categoryId);
  if (error) {
    console.error('[admin] deleteStickerCategory error', error);
    return { ok: false, error: 'Could not delete the category.' };
  }
  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker_category.deleted',
    p_entity_type: 'sticker',
    p_entity_id: categoryId,
    p_metadata: {},
  });
  revalidatePath('/admin/stickers');
  return { ok: true };
}

/** Persist a new category display order (array position = sort index). */
export async function reorderStickerCategories(input: unknown): Promise<StickerActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('sticker:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ReorderStickerCategoriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids } = parsed.data;

  const svc = createServiceClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await svc.from('sticker_categories').update({ sort: i }).eq('id', ids[i]);
    if (error) {
      console.error('[admin] reorderStickerCategories error', error);
      return { ok: false, error: 'Could not save the new order.' };
    }
  }
  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'sticker_category.reordered',
    p_entity_type: 'sticker',
    p_entity_id: ids[0],
    p_metadata: { count: ids.length },
  });
  revalidatePath('/admin/stickers');
  return { ok: true };
}
