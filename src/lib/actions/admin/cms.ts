'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireCmsCapability } from '@/lib/cms/access';
import { CmsSaveSchema, CmsStatusSchema, CmsBulkStatusSchema, CmsDuplicateSchema } from '@/lib/validations';
import { slugify } from '@/lib/cms/model';

export type CmsActionResult = { ok: true; id: string } | { ok: false; error: string };
export type CmsSimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-only CMS mutations. Mirrors the cover_templates pattern: authorization is enforced
 * HERE (requireCmsCapability — the future-RBAC seam), writes go through the service role
 * (authenticated/anon have NO write grant on content_pages), and every mutation records an
 * audit row via log_audit (entity_type 'content_page'). No emails, no customer side effects.
 */

type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'content_page',
    p_entity_id: id,
    p_metadata: metadata,
  });

/** Find a slug not yet taken: `base`, then `base-2`, `base-3`, … (ignores `exceptId`). */
async function uniqueSlug(svc: Svc, base: string, exceptId?: string): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    let q = svc.from('content_pages').select('id').eq('slug', candidate).limit(1);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Create or update a content page (status is NOT changed here — use setContentStatus). */
export async function saveContent(input: unknown): Promise<CmsActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCmsCapability('cms:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CmsSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const svc = createServiceClient();
  const now = new Date().toISOString();

  if (d.id) {
    // Update existing. Keep status untouched; re-slug only if the caller supplied one.
    const fields: Record<string, unknown> = {
      title: d.title,
      excerpt: d.excerpt ?? null,
      content: d.content ?? null,
      cover_image: d.coverImage ?? null,
      metadata: d.metadata ?? {},
      updated_at: now,
      updated_by: actor.userId,
    };
    if (d.slug) fields.slug = await uniqueSlug(svc, slugify(d.slug), d.id);

    const { data, error } = await svc.from('content_pages').update(fields).eq('id', d.id).select('id').maybeSingle();
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') return { ok: false, error: 'That slug is already in use.' };
      console.error('[admin] saveContent update error', error);
      return { ok: false, error: 'Could not save the content.' };
    }
    await audit(svc, actor.userId, 'cms.updated', d.id, { type: d.type, title: d.title });
    revalidatePath('/admin/cms/content');
    revalidatePath(`/admin/cms/content/${d.id}`);
    revalidateTag(CACHE_TAGS.cmsPublic); // editing a published page changes the public pages
    return { ok: true, id: d.id };
  }

  // Create. Generate id + a unique slug (from the supplied slug or the title).
  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.slug || d.title));
  const { error } = await svc.from('content_pages').insert({
    id,
    type: d.type,
    status: 'draft',
    title: d.title,
    slug,
    excerpt: d.excerpt ?? null,
    content: d.content ?? null,
    cover_image: d.coverImage ?? null,
    metadata: d.metadata ?? {},
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'That slug is already in use.' };
    console.error('[admin] saveContent insert error', error);
    return { ok: false, error: 'Could not create the content.' };
  }
  await audit(svc, actor.userId, 'cms.created', id, { type: d.type, title: d.title });
  // (create makes a DRAFT — no public impact, so no cms-public bust needed)
  revalidatePath('/admin/cms/content');
  revalidatePath('/admin/cms');
  return { ok: true, id };
}

/** Move a content page between draft / published / archived (sets published_at on first publish). */
export async function setContentStatus(input: unknown): Promise<CmsSimpleResult> {
  let actor: { userId: string };
  try {
    // Publish/archive could later need distinct capabilities; pick the closest one now.
    const cap = (input as { status?: string })?.status === 'archived' ? 'cms:archive' : 'cms:publish';
    actor = await requireCmsCapability(cap);
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CmsStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, status } = parsed.data;

  const svc = createServiceClient();
  const result = await applyStatus(svc, actor.userId, id, status);
  if (!result.ok) return result;

  revalidatePath('/admin/cms/content');
  revalidatePath(`/admin/cms/content/${id}`);
  revalidatePath('/admin/cms');
  revalidateTag(CACHE_TAGS.cmsPublic); // publish/unpublish/archive → refresh the public pages
  return { ok: true };
}

/** Shared status transition used by single + bulk actions. */
async function applyStatus(svc: Svc, actorId: string, id: string, status: string): Promise<CmsSimpleResult> {
  // Read the current row so we only stamp published_at on the FIRST publish.
  const { data: existing } = await svc.from('content_pages').select('published_at').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, error: 'Content not found.' };
  const hadPublished = (existing as { published_at: string | null }).published_at;

  const fields: Record<string, unknown> = { status, updated_at: new Date().toISOString(), updated_by: actorId };
  if (status === 'published' && !hadPublished) fields.published_at = new Date().toISOString();

  const { error } = await svc.from('content_pages').update(fields).eq('id', id);
  if (error) {
    console.error('[admin] applyStatus error', error);
    return { ok: false, error: 'Could not update the status.' };
  }
  const action = status === 'published' ? 'cms.published' : status === 'archived' ? 'cms.archived' : 'cms.unpublished';
  await audit(svc, actorId, action, id, { status });
  return { ok: true };
}

/** Bulk publish/archive selected items (small N; per-id audit keeps immutable history). */
export async function bulkSetContentStatus(input: unknown): Promise<CmsSimpleResult> {
  let actor: { userId: string };
  try {
    const cap = (input as { status?: string })?.status === 'archived' ? 'cms:archive' : 'cms:publish';
    actor = await requireCmsCapability(cap);
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CmsBulkStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids, status } = parsed.data;

  const svc = createServiceClient();
  for (const id of ids) {
    const r = await applyStatus(svc, actor.userId, id, status);
    if (!r.ok) return r;
  }

  revalidatePath('/admin/cms/content');
  revalidatePath('/admin/cms');
  revalidateTag(CACHE_TAGS.cmsPublic); // bulk publish/archive → refresh the public pages
  return { ok: true };
}

/** Duplicate a content page as a fresh DRAFT with a new id + slug. */
export async function duplicateContent(input: unknown): Promise<CmsActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCmsCapability('cms:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CmsDuplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: src } = await svc
    .from('content_pages')
    .select('type, title, slug, excerpt, content, cover_image, metadata')
    .eq('id', id)
    .maybeSingle();
  if (!src) return { ok: false, error: 'Content not found.' };
  const s = src as {
    type: string;
    title: string;
    slug: string;
    excerpt: string | null;
    content: string | null;
    cover_image: string | null;
    metadata: Record<string, unknown> | null;
  };

  const newId = randomUUID();
  const newTitle = `${s.title} (copy)`;
  const newSlug = await uniqueSlug(svc, slugify(s.slug || s.title));
  const { error } = await svc.from('content_pages').insert({
    id: newId,
    type: s.type,
    status: 'draft',
    title: newTitle,
    slug: newSlug,
    excerpt: s.excerpt,
    content: s.content,
    cover_image: s.cover_image,
    metadata: s.metadata ?? {},
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] duplicateContent error', error);
    return { ok: false, error: 'Could not duplicate the content.' };
  }
  await audit(svc, actor.userId, 'cms.duplicated', newId, { source_id: id, type: s.type });
  revalidatePath('/admin/cms/content');
  return { ok: true, id: newId };
}
