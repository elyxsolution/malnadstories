'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireTemplateCapability } from '@/lib/templates/access';
import { validateGeometry } from '@/lib/templates/model';
import { slugify } from '@/lib/cms/model';
import { TemplateSaveSchema, TemplateStatusSchema, TemplateDuplicateSchema } from '@/lib/validations';

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
    .select('name, slug, description, category, geometry, preview_image')
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
  };

  const newId = randomUUID();
  const newSlug = await uniqueSlug(svc, slugify(s.slug || s.name));
  const { error } = await svc.from('layout_templates').insert({
    id: newId,
    name: `${s.name} (copy)`,
    slug: newSlug,
    description: s.description,
    category: s.category,
    status: 'inactive',
    geometry: s.geometry,
    preview_image: s.preview_image,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] duplicateTemplate error', error);
    return { ok: false, error: 'Could not duplicate the template.' };
  }
  await audit(svc, actor.userId, 'template.duplicated', newId, { source_id: id, category: s.category });
  revalidatePath('/admin/templates');
  return { ok: true, id: newId };
}
