'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireProductCapability } from '@/lib/products/access';
import { ProductDemoAlbumSchema, ProductIdSchema } from '@/lib/validations';

/**
 * Demo Album assignment for the product preview (0048). A demo album is an EXISTING album
 * designated purely for preview — the customer flipbook renders it through the real pipeline.
 * Gated by `product:manage`; service-role writes; audited; busts the active-products cache.
 * Separate module so the Phase A product action layer is untouched.
 */

export type DemoResult = { ok: true } | { ok: false; error: string };

const bust = () => {
  revalidateTag(CACHE_TAGS.productsActive);
  revalidatePath('/admin/dimensions');
};

const audit = (svc: ReturnType<typeof createServiceClient>, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'album_product',
    p_entity_id: id,
    p_metadata: metadata,
  });

/** Assign (or replace) the product's demo album. Validates the album exists. */
export async function setProductDemoAlbum(input: unknown): Promise<DemoResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductDemoAlbumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { productId, albumId } = parsed.data;

  const svc = createServiceClient();
  const { data: album } = await svc.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'That album no longer exists.' };

  const { error } = await svc
    .from('album_products')
    .update({ demo_album_id: albumId, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', productId);
  if (error) return { ok: false, error: 'Could not set the demo album.' };
  await audit(svc, actor.userId, 'product.demo_album_set', productId, { albumId });
  bust();
  return { ok: true };
}

/** Remove the product's demo album (falls back to gallery images). */
export async function removeProductDemoAlbum(input: unknown): Promise<DemoResult> {
  let actor: { userId: string };
  try {
    actor = await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ProductIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const svc = createServiceClient();
  const { error } = await svc
    .from('album_products')
    .update({ demo_album_id: null, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', parsed.data.id);
  if (error) return { ok: false, error: 'Could not remove the demo album.' };
  await audit(svc, actor.userId, 'product.demo_album_removed', parsed.data.id, {});
  bust();
  return { ok: true };
}

/** Admin album picker source: recent albums with content, for choosing a demo album. */
export async function listAlbumsForDemo(input?: unknown): Promise<
  { ok: true; albums: { id: string; title: string; size: number; pages: number }[] } | { ok: false; error: string }
> {
  try {
    await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const q = z.object({ search: z.string().max(80).optional() }).safeParse(input ?? {});
  const search = q.success ? q.data.search?.trim() : undefined;

  const svc = createServiceClient();
  let query = svc.from('albums').select('id, title, size').order('updated_at', { ascending: false }).limit(40);
  if (search) query = query.ilike('title', `%${search}%`);
  const { data } = await query;
  const rows = (data ?? []) as { id: string; title: string; size: number }[];

  // Only offer albums that actually have content pages (a blank album is a poor demo).
  const withContent = await Promise.all(
    rows.map(async (a) => {
      const { count } = await svc.from('album_pages').select('id', { count: 'exact', head: true }).eq('album_id', a.id);
      return { ...a, pages: count ?? 0 };
    }),
  );
  return { ok: true, albums: withContent.filter((a) => a.pages > 0) };
}
