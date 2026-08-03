'use server';

import { randomUUID } from 'crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { CACHE_TAGS } from '@/lib/cache';
import { requireCoverTemplateCapability } from '@/lib/cover-templates/access';
import { validateCoverConfig } from '@/lib/cover-templates/model';
import { slugify } from '@/lib/cms/model';
import {
  CoverTemplateSaveSchema,
  CoverTemplateStatusSchema,
  CoverTemplateFeatureSchema,
  CoverTemplateDefaultSchema,
  CoverTemplateReorderSchema,
  CoverTemplateDuplicateSchema,
  CoverTemplateImportRequestSchema,
  COVER_TEMPLATE_EXPORT_VERSION,
} from '@/lib/validations';

export type CoverTemplateActionResult = { ok: true; id: string } | { ok: false; error: string };
export type CoverTemplateSimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-only cover-DESIGN-template mutations (0040). Mirrors the layout-template pattern:
 * authorization via requireCoverTemplateCapability (RBAC 'cover:manage'), service-role writes
 * (no client write grant), and audit via log_audit (entity_type 'cover_template_design'). The
 * config is RE-VALIDATED server-side here AND at the activation gate, so only a renderer-safe
 * CoverConfig can ever go active/selectable. No emails, no customer side effects.
 */

type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'cover_template_design',
    p_entity_id: id,
    p_metadata: metadata,
  });

async function uniqueSlug(svc: Svc, base: string, exceptId?: string): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    let q = svc.from('cover_design_templates').select('id').eq('slug', candidate).limit(1);
    if (exceptId) q = q.neq('id', exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

const bust = () => revalidateTag(CACHE_TAGS.coverTemplatesActive);

/** Create or update a cover template. Status is NOT changed here (use setCoverTemplateStatus). */
export async function saveCoverTemplate(input: unknown): Promise<CoverTemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CoverTemplateSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Strict config-safety gate (single source of cover truth; reuses CoverConfigSchema).
  const check = validateCoverConfig(d.config);
  if (!check.ok) return { ok: false, error: check.error ?? 'Invalid cover design.' };

  const svc = createServiceClient();
  const now = new Date().toISOString();

  if (d.id) {
    const fields: Record<string, unknown> = {
      name: d.name,
      description: d.description ?? null,
      category: d.category,
      featured: d.featured,
      popular: d.popular,
      pinned: d.pinned,
      config: d.config,
      updated_at: now,
      updated_by: actor.userId,
    };
    if (d.slug) fields.slug = await uniqueSlug(svc, slugify(d.slug), d.id);

    const { data, error } = await svc.from('cover_design_templates').update(fields).eq('id', d.id).select('id').maybeSingle();
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') return { ok: false, error: 'That slug is already in use.' };
      console.error('[admin] saveCoverTemplate update error', error);
      return { ok: false, error: 'Could not save the cover template.' };
    }
    await audit(svc, actor.userId, 'cover_template.updated', d.id, { name: d.name, category: d.category });
    revalidatePath('/admin/cover-templates');
    revalidatePath(`/admin/cover-templates/${d.id}`);
    bust();
    return { ok: true, id: d.id };
  }

  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.slug || d.name));
  const { error } = await svc.from('cover_design_templates').insert({
    id,
    name: d.name,
    slug,
    description: d.description ?? null,
    category: d.category,
    status: 'inactive', // new templates are unselectable until activated
    featured: d.featured,
    popular: d.popular,
    pinned: d.pinned,
    config: d.config,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'That slug is already in use.' };
    console.error('[admin] saveCoverTemplate insert error', error);
    return { ok: false, error: 'Could not create the cover template.' };
  }
  await audit(svc, actor.userId, 'cover_template.created', id, { name: d.name, category: d.category });
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true, id };
}

/** Activate / deactivate / archive. Activation RE-VALIDATES the config and refuses if invalid. */
export async function setCoverTemplateStatus(input: unknown): Promise<CoverTemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CoverTemplateStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, status } = parsed.data;

  const svc = createServiceClient();
  const { data: existing } = await svc.from('cover_design_templates').select('config').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, error: 'Cover template not found.' };

  // Activation gate: a template can only go ACTIVE if its config is renderer-safe.
  if (status === 'active') {
    const check = validateCoverConfig((existing as { config: unknown }).config);
    if (!check.ok) return { ok: false, error: `Cannot activate — the design is invalid: ${check.error}` };
  }

  // A template that leaves ACTIVE cannot remain THE default (0052): customers can't select an
  // inactive cover, so silently applying one to every new album would bypass that gate. Cleared
  // in the same write, which also frees the slot for another template.
  const fields: Record<string, unknown> = { status, updated_at: new Date().toISOString(), updated_by: actor.userId };
  if (status !== 'active') fields.is_default = false;

  const { error } = await svc.from('cover_design_templates').update(fields).eq('id', id);
  if (error) {
    console.error('[admin] setCoverTemplateStatus error', error);
    return { ok: false, error: 'Could not update the status.' };
  }
  const action = status === 'active' ? 'cover_template.activated' : status === 'archived' ? 'cover_template.archived' : 'cover_template.deactivated';
  await audit(svc, actor.userId, action, id, { status });

  revalidatePath('/admin/cover-templates');
  revalidatePath(`/admin/cover-templates/${id}`);
  bust();
  return { ok: true };
}

/** Feature / unfeature (featured templates surface first in the picker). */
export async function setCoverTemplateFeatured(input: unknown): Promise<CoverTemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverTemplateFeatureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, featured } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('cover_design_templates')
    .update({ featured, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    console.error('[admin] setCoverTemplateFeatured error', error);
    return { ok: false, error: 'Could not update the cover template.' };
  }
  await audit(svc, actor.userId, 'cover_template.featured', id, { featured });
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true };
}

/**
 * Set (or clear) THE default cover template (0052) — the one every new album receives
 * automatically, since the creation flow no longer asks the customer to pick a cover.
 *
 * Setting a default first clears the existing one (the partial unique index also guards this),
 * so there is never more than one. Clearing just unsets this row, after which album creation
 * falls back to a blank custom cover — exactly the behaviour before this feature existed.
 *
 * The template must be ACTIVE to become the default: an inactive row is not selectable by
 * customers, and silently applying one to every new album would bypass that gate.
 */
export async function setDefaultCoverTemplate(input: unknown): Promise<CoverTemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverTemplateDefaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, isDefault } = parsed.data;

  const svc = createServiceClient();
  const { data: row } = await svc.from('cover_design_templates').select('status').eq('id', id).maybeSingle();
  const r = row as { status: string } | null;
  if (!r) return { ok: false, error: 'Cover template not found.' };
  if (isDefault && r.status !== 'active') {
    return { ok: false, error: 'Activate this template before making it the default.' };
  }

  if (isDefault) {
    // Clear the current default FIRST so the unique index never trips.
    const { error: clearErr } = await svc
      .from('cover_design_templates')
      .update({ is_default: false })
      .eq('is_default', true);
    if (clearErr) {
      console.error('[admin] setDefaultCoverTemplate clear error', clearErr);
      return { ok: false, error: 'Could not update the default cover.' };
    }
  }

  const { error } = await svc
    .from('cover_design_templates')
    .update({ is_default: isDefault, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', id);
  if (error) {
    console.error('[admin] setDefaultCoverTemplate error', error);
    return { ok: false, error: 'Could not update the default cover.' };
  }

  await audit(svc, actor.userId, isDefault ? 'cover_template.set_default' : 'cover_template.unset_default', id, {});
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true };
}

/** Persist a new display order (array position = sort index). */
export async function reorderCoverTemplates(input: unknown): Promise<CoverTemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverTemplateReorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ids } = parsed.data;

  const svc = createServiceClient();
  const now = new Date().toISOString();
  // Small catalogs → sequential updates are fine and keep it simple + auditable.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await svc.from('cover_design_templates').update({ sort: i, updated_at: now }).eq('id', ids[i]);
    if (error) {
      console.error('[admin] reorderCoverTemplates error', error);
      return { ok: false, error: 'Could not save the new order.' };
    }
  }
  await audit(svc, actor.userId, 'cover_template.reordered', ids[0], { count: ids.length });
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true };
}

/** Duplicate a template as a fresh INACTIVE copy with a new id + slug. */
export async function duplicateCoverTemplate(input: unknown): Promise<CoverTemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CoverTemplateDuplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: src } = await svc
    .from('cover_design_templates')
    .select('name, slug, description, category, config')
    .eq('id', id)
    .maybeSingle();
  if (!src) return { ok: false, error: 'Cover template not found.' };
  const s = src as { name: string; slug: string; description: string | null; category: string; config: unknown };

  const newId = randomUUID();
  const newSlug = await uniqueSlug(svc, slugify(s.slug || s.name));
  const { error } = await svc.from('cover_design_templates').insert({
    id: newId,
    name: `${s.name} (copy)`,
    slug: newSlug,
    description: s.description,
    category: s.category,
    status: 'inactive',
    config: s.config,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] duplicateCoverTemplate error', error);
    return { ok: false, error: 'Could not duplicate the cover template.' };
  }
  await audit(svc, actor.userId, 'cover_template.duplicated', newId, { source_id: id, category: s.category });
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true, id: newId };
}

/**
 * Export a template as a portable, versioned JSON payload (Task 2). Contains everything needed to
 * recreate it — name/description/category/merchandising flags + the full CoverConfig — but NOT the
 * id/slug/status (an import always mints a fresh row or overwrites a chosen target). Gated read.
 */
export type CoverTemplateExportResult =
  | { ok: true; filename: string; json: string }
  | { ok: false; error: string };

export async function exportCoverTemplate(input: unknown): Promise<CoverTemplateExportResult> {
  try {
    await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverTemplateDuplicateSchema.safeParse(input); // { id }
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const svc = createServiceClient();
  const { data } = await svc
    .from('cover_design_templates')
    .select('name, slug, description, category, featured, popular, pinned, config')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!data) return { ok: false, error: 'Cover template not found.' };
  const t = data as {
    name: string;
    slug: string;
    description: string | null;
    category: string;
    featured: boolean;
    popular: boolean;
    pinned: boolean;
    config: unknown;
  };

  const payload = {
    schemaVersion: COVER_TEMPLATE_EXPORT_VERSION,
    name: t.name,
    description: t.description ?? undefined,
    category: t.category,
    featured: t.featured,
    popular: t.popular,
    pinned: t.pinned,
    config: t.config,
  };
  return {
    ok: true,
    filename: `cover-template-${t.slug || 'export'}.json`,
    json: JSON.stringify(payload, null, 2),
  };
}

/**
 * Import a template from a JSON payload (Task 2). Validates schemaVersion + the FULL shape via
 * CoverTemplateImportSchema (which reuses CoverConfigSchema), then re-validates the config at the
 * safety gate. `overwriteId` replaces that row's CONTENT (keeps its id/slug/status); otherwise a
 * fresh INACTIVE template is created. Invalid/incompatible files are rejected with a clear message.
 */
export async function importCoverTemplate(input: unknown): Promise<CoverTemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCoverTemplateCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CoverTemplateImportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { overwriteId, data } = parsed.data;

  // Defense in depth: the config must also pass the renderer-safety gate.
  const check = validateCoverConfig(data.config);
  if (!check.ok) return { ok: false, error: check.error ?? 'Invalid cover design in the imported file.' };

  const svc = createServiceClient();
  const now = new Date().toISOString();

  if (overwriteId) {
    const { data: existing, error } = await svc
      .from('cover_design_templates')
      .update({
        name: data.name,
        description: data.description ?? null,
        category: data.category,
        featured: data.featured,
        popular: data.popular,
        pinned: data.pinned,
        config: data.config,
        updated_at: now,
        updated_by: actor.userId,
      })
      .eq('id', overwriteId)
      .select('id')
      .maybeSingle();
    if (error || !existing) {
      console.error('[admin] importCoverTemplate overwrite error', error);
      return { ok: false, error: 'Could not overwrite the template.' };
    }
    await audit(svc, actor.userId, 'cover_template.imported', overwriteId, { mode: 'overwrite', name: data.name });
    revalidatePath('/admin/cover-templates');
    revalidatePath(`/admin/cover-templates/${overwriteId}`);
    bust();
    return { ok: true, id: overwriteId };
  }

  const id = randomUUID();
  const slug = await uniqueSlug(svc, slugify(data.name));
  const { error } = await svc.from('cover_design_templates').insert({
    id,
    name: data.name,
    slug,
    description: data.description ?? null,
    category: data.category,
    status: 'inactive', // imported templates start unselectable until activated
    featured: data.featured,
    popular: data.popular,
    pinned: data.pinned,
    config: data.config,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (error) {
    console.error('[admin] importCoverTemplate create error', error);
    return { ok: false, error: 'Could not import the template.' };
  }
  await audit(svc, actor.userId, 'cover_template.imported', id, { mode: 'create', name: data.name });
  revalidatePath('/admin/cover-templates');
  bust();
  return { ok: true, id };
}
