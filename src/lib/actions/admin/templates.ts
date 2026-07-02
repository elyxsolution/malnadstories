'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireTemplateCapability } from '@/lib/templates/access';
import { validateGeometry } from '@/lib/templates/model';
import { slugify } from '@/lib/cms/model';
import { deleteObject } from '@/lib/r2';
import {
  TemplateSaveSchema,
  TemplateStatusSchema,
  TemplateDuplicateSchema,
  SaveAlbumAsBlueprintSchema,
  UpdateBlueprintMetaSchema,
  BlueprintFeatureSchema,
  BlueprintReorderSchema,
  BlueprintDeleteSchema,
  BlueprintSchema,
} from '@/lib/validations';
import { blueprintFromBlocks, blueprintStats } from '@/lib/builder/blueprint';
import { LAYOUT_TEMPLATES, type Block, type LayoutTemplate } from '@/lib/builder/model';
import { startBlueprintThumbnail } from '@/lib/blueprints/thumbnail';

export type TemplateActionResult = { ok: true; id: string } | { ok: false; error: string };
export type TemplateSimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-only layout-template mutations. Mirrors the cover_templates pattern: authorization
 * via requireTemplateCapability (the future-RBAC seam), service-role writes (no client write
 * grant), and audit via log_audit (entity_type 'layout_template'). Geometry is RE-VALIDATED
 * server-side here AND at the activation gate — only renderer-safe presets can ever become
 * active/selectable. No emails, no customer side effects.
 */

type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'layout_template',
    p_entity_id: id,
    p_metadata: metadata,
  });

async function uniqueSlug(svc: Svc, base: string, exceptId?: string): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    let q = svc.from('layout_templates').select('id').eq('slug', candidate).limit(1);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** Create or update a template. Status is NOT changed here (use setTemplateStatus). */
export async function saveTemplate(input: unknown): Promise<TemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = TemplateSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Strict renderer-safety gate (single source of geometry truth).
  const geo = validateGeometry(d.geometry);
  if (!geo.ok) return { ok: false, error: geo.errors[0] ?? 'Invalid geometry.' };

  const svc = createServiceClient();
  const now = new Date().toISOString();

  if (d.id) {
    const fields: Record<string, unknown> = {
      name: d.name,
      description: d.description ?? null,
      category: d.category,
      geometry: d.geometry,
      preview_image: d.previewImage ?? null,
      updated_at: now,
      updated_by: actor.userId,
    };
    if (d.slug) fields.slug = await uniqueSlug(svc, slugify(d.slug), d.id);

    const { data, error } = await svc.from('layout_templates').update(fields).eq('id', d.id).select('id').maybeSingle();
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') return { ok: false, error: 'That slug is already in use.' };
      console.error('[admin] saveTemplate update error', error);
      return { ok: false, error: 'Could not save the template.' };
    }
    await audit(svc, actor.userId, 'template.updated', d.id, { name: d.name, category: d.category });
    revalidatePath('/admin/templates');
    revalidatePath(`/admin/templates/${d.id}`);
    revalidateTag(CACHE_TAGS.templatesActive); // editing an active template changes the catalog
    return { ok: true, id: d.id };
  }

  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.slug || d.name));
  const { error } = await svc.from('layout_templates').insert({
    id,
    name: d.name,
    slug,
    description: d.description ?? null,
    category: d.category,
    status: 'inactive', // new templates are unselectable until validated + activated
    geometry: d.geometry,
    preview_image: d.previewImage ?? null,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'That slug is already in use.' };
    console.error('[admin] saveTemplate insert error', error);
    return { ok: false, error: 'Could not create the template.' };
  }
  await audit(svc, actor.userId, 'template.created', id, { name: d.name, category: d.category });
  revalidatePath('/admin/templates');
  return { ok: true, id };
}

/** Activate / deactivate / archive. Activation RE-VALIDATES geometry and refuses if invalid. */
export async function setTemplateStatus(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    const cap = (input as { status?: string })?.status === 'archived' ? 'template:archive' : 'template:publish';
    actor = await requireTemplateCapability(cap);
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = TemplateStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, status } = parsed.data;

  const svc = createServiceClient();
  const { data: existing } = await svc.from('layout_templates').select('geometry').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, error: 'Template not found.' };

  // Activation gate: a template can only go ACTIVE if its geometry is renderer-safe.
  if (status === 'active') {
    const geo = validateGeometry((existing as { geometry: unknown }).geometry);
    if (!geo.ok) return { ok: false, error: `Cannot activate — geometry is invalid: ${geo.errors[0]}` };
  }

  const { error } = await svc
    .from('layout_templates')
    .update({ status, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id);
  if (error) {
    console.error('[admin] setTemplateStatus error', error);
    return { ok: false, error: 'Could not update the status.' };
  }
  const action = status === 'active' ? 'template.activated' : status === 'archived' ? 'template.archived' : 'template.deactivated';
  await audit(svc, actor.userId, action, id, { status });

  revalidatePath('/admin/templates');
  revalidatePath(`/admin/templates/${id}`);
  revalidateTag(CACHE_TAGS.templatesActive); // activate/deactivate/archive → refresh the builder catalog
  return { ok: true };
}

/** Duplicate a template as a fresh INACTIVE copy with a new id + slug. */
export async function duplicateTemplate(input: unknown): Promise<TemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = TemplateDuplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: src } = await svc
    .from('layout_templates')
    .select('name, slug, description, category, geometry, preview_image, blueprint, page_count, slot_count, recommended_photos')
    .eq('id', id)
    .maybeSingle();
  if (!src) return { ok: false, error: 'Template not found.' };
  const s = src as {
    name: string;
    slug: string;
    description: string | null;
    category: string;
    geometry: unknown;
    preview_image: string | null;
    blueprint: unknown;
    page_count: number | null;
    slot_count: number | null;
    recommended_photos: number | null;
  };

  const newId = randomUUID();
  const newSlug = await uniqueSlug(svc, slugify(s.slug || s.name));
  // Copy blueprint + derived stats too (for blueprint rows); fresh copies start unfeatured/unpinned
  // and drop thumb_key (regenerated). Presets (blueprint null) behave exactly as before.
  const { error } = await svc.from('layout_templates').insert({
    id: newId,
    name: `${s.name} (copy)`,
    slug: newSlug,
    description: s.description,
    category: s.category,
    status: 'inactive',
    geometry: s.geometry,
    preview_image: s.preview_image,
    blueprint: s.blueprint ?? null,
    page_count: s.page_count,
    slot_count: s.slot_count,
    recommended_photos: s.recommended_photos,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] duplicateTemplate error', error);
    return { ok: false, error: 'Could not duplicate the template.' };
  }
  await audit(svc, actor.userId, s.blueprint ? 'blueprint.duplicated' : 'template.duplicated', newId, { source_id: id, category: s.category });
  // A blueprint copy is new content → generate its own thumbnail (the copy dropped thumb_key).
  if (s.blueprint) await startBlueprintThumbnail(newId);
  revalidatePath('/admin/templates');
  revalidateTag(CACHE_TAGS.templatesActive);
  return { ok: true, id: newId };
}

// ── Album Blueprints (0043) ────────────────────────────────────────────────────
// Blueprints are layout_templates rows with a non-null `blueprint`. They reuse this module's auth
// (requireTemplateCapability), service-role writes, audit, and cache tag — NO new admin module.
// setTemplateStatus + duplicateTemplate above already handle them; below adds create/edit/feature/
// reorder/delete. Derived stats (page/slot/recommended) are computed here, never client-supplied.

const bustTemplates = () => revalidateTag(CACHE_TAGS.templatesActive);
const isTpl = (t: string | null): t is LayoutTemplate => !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

/**
 * Save an existing album's layout as a reusable Blueprint (reuses the builder for authoring — an
 * admin arranges a normal album, then saves it). Distills the album's Block[] into a blueprint
 * (photos stripped → empty slots), computes stats, inserts an INACTIVE blueprint row. The album
 * must belong to the acting admin.
 */
export async function saveAlbumAsBlueprint(input: unknown): Promise<TemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = SaveAlbumAsBlueprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const svc = createServiceClient();
  const { data: album } = await svc.from('albums').select('id, user_id').eq('id', d.albumId).maybeSingle();
  const a = album as { id: string; user_id: string } | null;
  if (!a) return { ok: false, error: 'Album not found.' };
  if (a.user_id !== actor.userId) return { ok: false, error: 'You can only blueprint your own album.' };

  const { data: pageData } = await svc
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', d.albumId)
    .order('page_number', { ascending: true });

  type PageRow = {
    layout_template: string | null;
    caption: string | null;
    photo_ids: string[] | null;
    layout_config: { overlays?: unknown[]; texts?: unknown[]; qrs?: unknown[]; stickers?: unknown[]; background?: unknown } | null;
  };
  const blocks = ((pageData ?? []) as PageRow[])
    .filter((r) => isTpl(r.layout_template))
    .map(
      (r) =>
        ({
          key: '',
          template: r.layout_template as LayoutTemplate,
          photoIds: r.photo_ids ?? [],
          caption: r.caption ?? '',
          overlays: (r.layout_config?.overlays ?? []) as Block['overlays'],
          texts: (r.layout_config?.texts ?? []) as Block['texts'],
          qrs: (r.layout_config?.qrs ?? []) as Block['qrs'],
          stickers: (r.layout_config?.stickers ?? []) as Block['stickers'],
          background: (r.layout_config?.background ?? null) as Block['background'],
        }) satisfies Block,
    );
  if (blocks.length === 0) return { ok: false, error: 'This album has no pages to blueprint yet.' };

  const bp = blueprintFromBlocks(blocks);
  const check = BlueprintSchema.safeParse(bp);
  if (!check.success) return { ok: false, error: 'Album layout could not be converted to a valid blueprint.' };
  const stats = blueprintStats(bp);

  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.name));
  const { error } = await svc.from('layout_templates').insert({
    id,
    name: d.name,
    slug,
    description: d.description ?? null,
    category: d.category,
    status: 'inactive',
    geometry: { base: bp.blocks[0]?.template ?? 'single-pair', overlays: [] }, // valid default (NOT NULL)
    blueprint: bp,
    page_count: stats.pageCount,
    slot_count: stats.slotCount,
    recommended_photos: stats.recommendedPhotos,
    featured: d.featured,
    popular: d.popular,
    pinned: d.pinned,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] saveAlbumAsBlueprint error', error);
    return { ok: false, error: 'Could not save the blueprint.' };
  }
  await audit(svc, actor.userId, 'blueprint.created', id, { name: d.name, pageCount: stats.pageCount, slotCount: stats.slotCount });
  // Content-changing event → (re)generate the cached thumbnail. Best-effort; never blocks the save.
  await startBlueprintThumbnail(id);
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true, id };
}

/** Edit a blueprint's metadata (name/description/category). Geometry edits = re-save from an album. */
export async function updateBlueprintMeta(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = UpdateBlueprintMetaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, name, description, category } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('layout_templates')
    .update({ name, description: description ?? null, category, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id)
    .not('blueprint', 'is', null)
    .select('id')
    .maybeSingle();
  if (error || !data) return { ok: false, error: 'Could not update the blueprint.' };
  await audit(svc, actor.userId, 'blueprint.updated', id, { name, category });
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
}

/** Feature / popular / pinned toggles for a blueprint. */
export async function setBlueprintFeatured(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BlueprintFeatureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, featured, popular, pinned } = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.userId };
  if (featured !== undefined) patch.featured = featured;
  if (popular !== undefined) patch.popular = popular;
  if (pinned !== undefined) patch.pinned = pinned;

  const svc = createServiceClient();
  const { data, error } = await svc.from('layout_templates').update(patch).eq('id', id).not('blueprint', 'is', null).select('id').maybeSingle();
  if (error || !data) return { ok: false, error: 'Could not update the blueprint.' };
  await audit(svc, actor.userId, 'blueprint.featured', id, { featured, popular, pinned });
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
}

/** Persist a new blueprint display order (array position = sort). */
export async function reorderBlueprints(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BlueprintReorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids } = parsed.data;
  const svc = createServiceClient();
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await svc.from('layout_templates').update({ sort: i, updated_at: now }).eq('id', ids[i]);
    if (error) return { ok: false, error: 'Could not save the new order.' };
  }
  await audit(svc, actor.userId, 'blueprint.reordered', ids[0], { count: ids.length });
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
}

/** Hard-delete a blueprint (+ its cached thumbnail). Archive (setTemplateStatus) is the soft option. */
export async function deleteBlueprint(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:archive');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BlueprintDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: row } = await svc.from('layout_templates').select('thumb_key').eq('id', id).not('blueprint', 'is', null).maybeSingle();
  if (!row) return { ok: false, error: 'Blueprint not found.' };

  const { error } = await svc.from('layout_templates').delete().eq('id', id);
  if (error) return { ok: false, error: 'Could not delete the blueprint.' };

  const thumbKey = (row as { thumb_key: string | null }).thumb_key;
  if (thumbKey) await deleteObject(thumbKey).catch(() => {});

  await audit(svc, actor.userId, 'blueprint.deleted', id, {});
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
}
