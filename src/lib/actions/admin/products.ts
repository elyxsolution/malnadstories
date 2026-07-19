'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireProductCapability } from '@/lib/products/access';
import { validateProductInput, aspectFromCm } from '@/lib/products/model';
import { slugify } from '@/lib/cms/model';
import { deleteObject } from '@/lib/r2';
import {
  ProductSaveSchema,
  ProductStatusSchema,
  ProductIdSchema,
  ProductPreviewReorderSchema,
  ProductPreviewKeySchema,
} from '@/lib/validations';

/**
 * Album Product ("Dimensions") admin mutations (0047). Mirrors the template/cover pattern:
 * authorization via requireProductCapability (RBAC seam), service-role writes (no client write
 * grant on the catalog), audit via log_audit (entity_type 'album_product'), and a cache bust of
 * the active-products tag on every write. Dimensions/prices are validated positive here AND by
 * the pure model validators. NO payment/order/album side effects.
 */

export type ProductResult = { ok: true; id: string } | { ok: false; error: string };
export type ProductSimpleResult = { ok: true } | { ok: false; error: string };
export type ProductDeleteResult = { ok: true } | { ok: false; error: string; blocked?: boolean };

type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'album_product',
    p_entity_id: id,
    p_metadata: metadata,
  });

const bust = () => {
  revalidateTag(CACHE_TAGS.productsActive);
  revalidatePath('/admin/dimensions');
};

async function uniqueSlug(svc: Svc, base: string, exceptId?: string): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    let q = svc.from('album_products').select('id').eq('slug', candidate).limit(1);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Replace the full price set for a product (prices are edited as a complete array). */
async function replacePrices(svc: Svc, productId: string, prices: { pageCount: number; price: number }[]) {
  await svc.from('album_product_prices').delete().eq('product_id', productId);
  if (prices.length > 0) {
    await svc.from('album_product_prices').insert(
      prices.map((p) => ({ product_id: productId, page_count: p.pageCount, price: p.price })),
    );
  }
}

/** Create or update a product (name + dimensions + supported page counts/prices). */
export async function saveProduct(input: unknown): Promise<ProductResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ProductSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Positive dimensions + non-empty name (single source of truth).
  const check = validateProductInput({
    name: d.name,
    widthCm: d.widthCm,
    heightCm: d.heightCm,
    printWidthCm: d.printWidthCm,
    printHeightCm: d.printHeightCm,
  });
  if (!check.ok) return { ok: false, error: check.error! };

  // No duplicate page counts within one product.
  const counts = new Set<number>();
  for (const row of d.prices) {
    if (counts.has(row.pageCount)) return { ok: false, error: `Page count ${row.pageCount} is listed twice.` };
    counts.add(row.pageCount);
  }

  const svc = createServiceClient();

  // No duplicate NAME (case-insensitive) — DB has a unique index too; this gives a clean message.
  let nameQ = svc.from('album_products').select('id').ilike('name', d.name);
  if (d.id) nameQ = nameQ.neq('id', d.id);
  const { data: dupe } = await nameQ.maybeSingle();
  if (dupe) return { ok: false, error: 'A product with that name already exists.' };

  const aspect = aspectFromCm(d.widthCm, d.heightCm);
  const now = new Date().toISOString();

  if (d.id) {
    const { data, error } = await svc
      .from('album_products')
      .update({
        name: d.name,
        description: d.description ?? null,
        width_cm: d.widthCm,
        height_cm: d.heightCm,
        builder_aspect_ratio: aspect,
        print_width_cm: d.printWidthCm,
        print_height_cm: d.printHeightCm,
        display_order: d.displayOrder ?? 0,
        best_for: d.bestFor ?? [],
        updated_at: now,
        updated_by: actor.userId,
      })
      .eq('id', d.id)
      .select('id')
      .maybeSingle();
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') return { ok: false, error: 'That name is already in use.' };
      console.error('[admin] saveProduct update error', error);
      return { ok: false, error: 'Could not save the product.' };
    }
    await replacePrices(svc, d.id, d.prices);
    await audit(svc, actor.userId, 'product.updated', d.id, { name: d.name, aspect });
    bust();
    return { ok: true, id: d.id };
  }

  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.name));
  const { error } = await svc.from('album_products').insert({
    id,
    name: d.name,
    slug,
    description: d.description ?? null,
    width_cm: d.widthCm,
    height_cm: d.heightCm,
    builder_aspect_ratio: aspect,
    print_width_cm: d.printWidthCm,
    print_height_cm: d.printHeightCm,
    display_order: d.displayOrder ?? 0,
    best_for: d.bestFor ?? [],
    is_default: false, // new products are never default until explicitly set
    is_active: true,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'That name is already in use.' };
    console.error('[admin] saveProduct insert error', error);
    return { ok: false, error: 'Could not create the product.' };
  }
  await replacePrices(svc, id, d.prices);
  await audit(svc, actor.userId, 'product.created', id, { name: d.name, aspect });
  bust();
  return { ok: true, id };
}

/** Enable / disable a product (soft — hides it from the customer picker; existing albums unaffected). */
export async function setProductActive(input: unknown): Promise<ProductSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, isActive } = parsed.data;

  const svc = createServiceClient();
  // Never leave zero active default: refuse to disable the default product.
  if (!isActive) {
    const { data } = await svc.from('album_products').select('is_default').eq('id', id).maybeSingle();
    if ((data as { is_default: boolean } | null)?.is_default) {
      return { ok: false, error: 'Set another product as default before disabling this one.' };
    }
  }
  const { error } = await svc
    .from('album_products')
    .update({ is_active: isActive, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id);
  if (error) return { ok: false, error: 'Could not update the product.' };
  await audit(svc, actor.userId, isActive ? 'product.enabled' : 'product.disabled', id, {});
  bust();
  return { ok: true };
}

/** Set THE one default product (clears the previous default first; the partial unique index backs this). */
export async function setDefaultProduct(input: unknown): Promise<ProductSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: prod } = await svc.from('album_products').select('is_active').eq('id', id).maybeSingle();
  if (!prod) return { ok: false, error: 'Product not found.' };
  if (!(prod as { is_active: boolean }).is_active) return { ok: false, error: 'Enable the product before making it default.' };

  // Clear existing default FIRST so the one-default unique index never trips.
  const { error: clearErr } = await svc.from('album_products').update({ is_default: false }).eq('is_default', true);
  if (clearErr) return { ok: false, error: 'Could not update the default.' };
  const { error } = await svc
    .from('album_products')
    .update({ is_default: true, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id);
  if (error) return { ok: false, error: 'Could not update the default.' };
  await audit(svc, actor.userId, 'product.set_default', id, {});
  bust();
  return { ok: true };
}

/** Delete a product — ONLY when nothing references it (no albums, no orders). Removes its R2 assets. */
export async function deleteProduct(input: unknown): Promise<ProductDeleteResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const [{ count: albumCount }, { count: orderCount }] = await Promise.all([
    svc.from('albums').select('id', { count: 'exact', head: true }).eq('product_id', id),
    svc.from('orders').select('id', { count: 'exact', head: true }).eq('product_id', id),
  ]);
  if ((albumCount ?? 0) > 0 || (orderCount ?? 0) > 0) {
    await audit(svc, actor.userId, 'product.delete_blocked', id, { albums: albumCount, orders: orderCount });
    return { ok: false, blocked: true, error: 'This product is in use and can’t be deleted. Disable it instead.' };
  }

  // Gather R2 assets (cover preview + gallery) before deleting rows.
  const { data: prod } = await svc.from('album_products').select('cover_preview_key').eq('id', id).maybeSingle();
  const { data: previews } = await svc.from('album_product_previews').select('image_key').eq('product_id', id);
  const keys = [
    (prod as { cover_preview_key: string | null } | null)?.cover_preview_key ?? null,
    ...((previews ?? []) as { image_key: string }[]).map((p) => p.image_key),
  ].filter((k): k is string => !!k);

  // Cascade removes prices + previews rows.
  const { error } = await svc.from('album_products').delete().eq('id', id);
  if (error) {
    console.error('[admin] deleteProduct error', error);
    return { ok: false, error: 'Could not delete the product.' };
  }
  for (const k of keys) await deleteObject(k).catch(() => {});
  await audit(svc, actor.userId, 'product.deleted', id, {});
  bust();
  return { ok: true };
}

/** Set the single cover preview image (imageKey already uploaded to R2 via the admin presign flow). */
export async function setProductCoverPreview(input: unknown): Promise<ProductSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductPreviewKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { productId, imageKey } = parsed.data;

  const svc = createServiceClient();
  const { data: prev } = await svc.from('album_products').select('cover_preview_key').eq('id', productId).maybeSingle();
  const oldKey = (prev as { cover_preview_key: string | null } | null)?.cover_preview_key ?? null;
  const { error } = await svc
    .from('album_products')
    .update({ cover_preview_key: imageKey, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', productId);
  if (error) return { ok: false, error: 'Could not set the cover preview.' };
  if (oldKey && oldKey !== imageKey) await deleteObject(oldKey).catch(() => {});
  await audit(svc, actor.userId, 'product.cover_preview_set', productId, {});
  bust();
  return { ok: true };
}

/** Append a gallery preview image (imageKey already uploaded to R2). */
export async function addProductPreview(input: unknown): Promise<ProductResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductPreviewKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { productId, imageKey } = parsed.data;

  const svc = createServiceClient();
  const { count } = await svc.from('album_product_previews').select('id', { count: 'exact', head: true }).eq('product_id', productId);
  const id = randomUUID();
  const { error } = await svc
    .from('album_product_previews')
    .insert({ id, product_id: productId, image_key: imageKey, sort_order: count ?? 0 });
  if (error) return { ok: false, error: 'Could not add the preview.' };
  await audit(svc, actor.userId, 'product.preview_added', productId, {});
  bust();
  return { ok: true, id };
}

/** Remove a gallery preview image (+ its R2 object). */
export async function removeProductPreview(input: unknown): Promise<ProductSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductIdSchema.safeParse(input); // { id } = the preview row id
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: row } = await svc.from('album_product_previews').select('image_key, product_id').eq('id', id).maybeSingle();
  const r = row as { image_key: string; product_id: string } | null;
  if (!r) return { ok: false, error: 'Preview not found.' };
  const { error } = await svc.from('album_product_previews').delete().eq('id', id);
  if (error) return { ok: false, error: 'Could not remove the preview.' };
  await deleteObject(r.image_key).catch(() => {});
  await audit(svc, actor.userId, 'product.preview_removed', r.product_id, {});
  bust();
  return { ok: true };
}

/** Reorder the gallery previews (array position = sort_order). */
export async function reorderProductPreviews(input: unknown): Promise<ProductSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductPreviewReorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { productId, ids } = parsed.data;

  const svc = createServiceClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await svc.from('album_product_previews').update({ sort_order: i }).eq('id', ids[i]).eq('product_id', productId);
    if (error) return { ok: false, error: 'Could not save the new order.' };
  }
  await audit(svc, actor.userId, 'product.previews_reordered', productId, { count: ids.length });
  bust();
  return { ok: true };
}
