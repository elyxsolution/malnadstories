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
  LayoutPresetIdSchema,
  CreateBlankBlueprintSchema,
  UpdateBlueprintMetaSchema,
  BlueprintFeatureSchema,
  BlueprintReorderSchema,
  BlueprintDeleteSchema,
  SetBlueprintDefaultSchema,
  OpenBlueprintForEditingSchema,
  UpdateBlueprintFromAlbumSchema,
  BlueprintSchema,
} from '@/lib/validations';
import { blueprintFromBlocks, blueprintStats, applyBlueprint, normalizeBlueprint } from '@/lib/builder/blueprint';
import { getValidAlbumPageCounts } from '@/lib/products/catalog';
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

// ── Layout Preset — safe delete (dependency-checked) ─────────────────────────────
// A layout PRESET is a layout_templates row with a NULL blueprint. Deleting the row can never
// break rendering (albums/blueprints store their own materialized geometry + a preset KEY, never
// the row id). But as a PRODUCT safety rule we still refuse to delete a preset that is "in use":
// we count how many ALBUMS (incl. draft/blueprint-draft albums) and BLUEPRINTS reference this
// preset by its stored key (the block.preset id we persist), NOT by renderer geometry. The preset's
// stable key for matching is its slug (e.g. 'panorama'). Referenced → blocked (Archive instead).

export type PresetDeps = { albums: number; blueprints: number };

/** Count blueprints + albums whose stored block preset key === this preset's slug. Service role. */
async function presetReferences(svc: Svc, slug: string): Promise<PresetDeps> {
  // Albums (incl. draft + blueprint-draft albums): pages whose stored preset key matches. Fetch only
  // the matching pages via a JSON filter, then dedupe by album.
  let albums = 0;
  try {
    const { data } = await svc.from('album_pages').select('album_id').filter('layout_config->>preset', 'eq', slug);
    albums = new Set(((data ?? []) as { album_id: string }[]).map((p) => p.album_id)).size;
  } catch (e) {
    console.error('[admin] presetReferences album scan failed', e);
  }
  // Blueprints: any block in the stored blueprint jsonb uses this preset key (catalog is small).
  let blueprints = 0;
  try {
    const { data } = await svc.from('layout_templates').select('id, blueprint').not('blueprint', 'is', null);
    for (const r of (data ?? []) as { id: string; blueprint: { blocks?: { preset?: string }[] } | null }[]) {
      if ((r.blueprint?.blocks ?? []).some((b) => b?.preset === slug)) blueprints += 1;
    }
  } catch (e) {
    console.error('[admin] presetReferences blueprint scan failed', e);
  }
  return { albums, blueprints };
}

export type PresetDepsResult = { ok: true; deps: PresetDeps } | { ok: false; error: string };

/** Read-only dependency analysis for the delete confirmation dialog. Gated. */
export async function checkLayoutPresetDependencies(input: unknown): Promise<PresetDepsResult> {
  try {
    await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = LayoutPresetIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const svc = createServiceClient();
  const { data } = await svc.from('layout_templates').select('slug').eq('id', parsed.data.id).is('blueprint', null).maybeSingle();
  const row = data as { slug: string } | null;
  if (!row) return { ok: false, error: 'Layout preset not found.' };
  return { ok: true, deps: await presetReferences(svc, row.slug) };
}

export type DeletePresetResult = { ok: true } | { ok: false; error: string; blocked?: boolean; deps?: PresetDeps };

/**
 * Permanently delete a layout preset — ONLY when it has zero references. Re-runs the dependency
 * check inside the action (defense against a TOCTOU race), refuses with a structured `blocked`
 * result if referenced (never partial-deletes), else removes the row + any cached thumbnail, audits,
 * and busts the catalog cache. Service-role; requires template:edit.
 */
export async function deleteLayoutPreset(input: unknown): Promise<DeletePresetResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = LayoutPresetIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data } = await svc.from('layout_templates').select('slug, thumb_key').eq('id', id).is('blueprint', null).maybeSingle();
  const preset = data as { slug: string; thumb_key: string | null } | null;
  if (!preset) return { ok: false, error: 'Layout preset not found.' };

  // Always audit the ATTEMPT (security), then re-check dependencies right before deleting.
  await audit(svc, actor.userId, 'preset.delete_attempted', id, { slug: preset.slug });
  const deps = await presetReferences(svc, preset.slug);
  if (deps.albums > 0 || deps.blueprints > 0) {
    await audit(svc, actor.userId, 'preset.delete_blocked', id, { slug: preset.slug, ...deps });
    return { ok: false, blocked: true, deps, error: 'This layout preset is still in use.' };
  }

  const { error } = await svc.from('layout_templates').delete().eq('id', id).is('blueprint', null);
  if (error) {
    console.error('[admin] deleteLayoutPreset error', error);
    return { ok: false, error: 'Could not delete the layout preset.' };
  }
  if (preset.thumb_key) await deleteObject(preset.thumb_key).catch(() => {});

  await audit(svc, actor.userId, 'preset.deleted', id, { slug: preset.slug });
  revalidatePath('/admin/templates');
  revalidateTag(CACHE_TAGS.templatesActive);
  return { ok: true };
}

// ── Album Blueprints (0043) ────────────────────────────────────────────────────
// Blueprints are layout_templates rows with a non-null `blueprint`. They reuse this module's auth
// (requireTemplateCapability), service-role writes, audit, and cache tag — NO new admin module.
// setTemplateStatus + duplicateTemplate above already handle them; below adds create/edit/feature/
// reorder/delete. Derived stats (page/slot/recommended) are computed here, never client-supplied.

const bustTemplates = () => revalidateTag(CACHE_TAGS.templatesActive);
const isTpl = (t: string | null): t is LayoutTemplate => !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

/**
 * New Blueprint (empty) → open in the builder. Creates a BLANK blueprint row (no blocks) for the
 * chosen album size, plus a linked draft album (blueprint_draft_of), and returns the album id so
 * the caller opens `/albums/[id]/build` in blueprint-edit mode. On Save, `updateBlueprintFromAlbum`
 * distils the designed pages back into THIS same blueprint — one unified authoring path, no "Save
 * As". The size is validated against active products (data-driven; never a hardcoded literal).
 */
export type CreateBlueprintResult = { ok: true; albumId: string; blueprintId: string } | { ok: false; error: string };
export async function createBlankBlueprint(input: unknown): Promise<CreateBlueprintResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CreateBlankBlueprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const svc = createServiceClient();

  // Data-driven size gate: the size must be a page count offered by an active ALBUM PRODUCT (0047).
  const validSizes = new Set(await getValidAlbumPageCounts());
  if (!validSizes.has(d.size)) return { ok: false, error: 'Choose a valid album size.' };

  const blueprintId = randomUUID();
  const slug = await uniqueSlug(svc, slugify(d.name));
  const emptyBlueprint = { version: 1 as const, blocks: [] as never[] };
  const { error: bpErr } = await svc.from('layout_templates').insert({
    id: blueprintId,
    name: d.name,
    slug,
    description: null,
    category: d.category,
    status: 'inactive',
    geometry: { base: 'single-pair', overlays: [] }, // valid default (NOT NULL); real geometry lives in blueprint
    blueprint: emptyBlueprint,
    page_count: 0,
    slot_count: 0,
    recommended_photos: 0,
    created_by: actor.userId,
    updated_by: actor.userId,
  });
  if (bpErr) {
    console.error('[admin] createBlankBlueprint blueprint insert error', bpErr);
    return { ok: false, error: 'Could not create the blueprint.' };
  }

  const { data: albumRow, error: albErr } = await svc
    .from('albums')
    .insert({ user_id: actor.userId, title: `Blueprint: ${d.name}`, size: d.size, blueprint_draft_of: blueprintId })
    .select('id')
    .single();
  if (albErr || !albumRow) {
    console.error('[admin] createBlankBlueprint album insert error', albErr);
    await svc.from('layout_templates').delete().eq('id', blueprintId); // roll back the orphan blueprint
    return { ok: false, error: 'Could not create the blueprint.' };
  }

  await audit(svc, actor.userId, 'blueprint.created', blueprintId, { name: d.name, size: d.size, blank: true });
  return { ok: true, albumId: (albumRow as { id: string }).id, blueprintId };
}

// Turn Block[] into album_pages rows (mirrors saveLayout's persistence shape, incl. preset).
function blocksToPageRows(albumId: string, blocks: Block[]) {
  return blocks.map((b, i) => {
    const hasContent =
      b.overlays.length > 0 || b.texts.length > 0 || b.qrs.length > 0 || b.stickers.length > 0 || !!b.background || !!b.preset;
    return {
      album_id: albumId,
      page_number: i,
      layout_template: b.template,
      caption: b.caption || null,
      photo_ids: b.photoIds,
      layout_config: hasContent
        ? {
            overlays: b.overlays,
            ...(b.texts.length > 0 ? { texts: b.texts } : {}),
            ...(b.qrs.length > 0 ? { qrs: b.qrs } : {}),
            ...(b.stickers.length > 0 ? { stickers: b.stickers } : {}),
            ...(b.background ? { background: b.background } : {}),
            ...(b.preset ? { preset: b.preset } : {}),
          }
        : null,
    };
  });
}

/**
 * Open a blueprint for editing in the EXISTING builder (0046). Creates a short-lived admin-owned
 * DRAFT album from the blueprint's layout (empty photo slots), returns its id so the caller opens
 * `/albums/[id]/build`. The builder detects the draft (albums.blueprint_draft_of) and turns "Save"
 * into an update of the SAME blueprint. Reuses the builder + applyBlueprint — no new editor.
 */
export type OpenBlueprintResult = { ok: true; albumId: string } | { ok: false; error: string };
export async function openBlueprintForEditing(input: unknown): Promise<OpenBlueprintResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = OpenBlueprintForEditingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data: bpRow } = await svc.from('layout_templates').select('id, name, page_count, blueprint').eq('id', id).not('blueprint', 'is', null).maybeSingle();
  const bp = bpRow as { id: string; name: string; page_count: number | null; blueprint: unknown } | null;
  if (!bp) return { ok: false, error: 'Blueprint not found.' };
  const size = bp.page_count ?? 0;
  if (!size) return { ok: false, error: 'This blueprint has no page count.' };

  // Clean up any earlier draft for this blueprint by this admin (cascade removes its pages).
  await svc.from('albums').delete().eq('user_id', actor.userId).eq('blueprint_draft_of', id);

  // Normalise BEFORE the insert: the draft album must be seeded with the blueprint's cover in the
  // same statement that creates it, so the admin never sees a blueprint open with a blank cover
  // and then silently save that blankness back over the real design.
  const normalized = normalizeBlueprint(bp.blueprint);

  const { data: albumRow, error: albErr } = await svc
    .from('albums')
    .insert({
      user_id: actor.userId,
      title: `Blueprint: ${bp.name}`,
      size,
      blueprint_draft_of: id,
      /*
       * THE COVER TRAVELS INTO THE DRAFT (Phase 0).
       *
       * The draft album IS the blueprint editor — it opens in the customer's own builder, which
       * already knows how to edit a cover from `albums.cover_config`. So seeding this column is
       * the whole of "the blueprint editor can edit the cover"; no second cover editor exists and
       * none is needed. A blueprint with no cover yet seeds nothing and the draft starts on the
       * builder's ordinary default, exactly as every blueprint draft did before.
       */
      ...(normalized?.cover ? { cover_config: normalized.cover } : {}),
    })
    .select('id')
    .single();
  if (albErr || !albumRow) {
    console.error('[admin] openBlueprintForEditing album insert error', albErr);
    return { ok: false, error: 'Could not open the blueprint for editing.' };
  }
  const albumId = (albumRow as { id: string }).id;

  // Materialize the blueprint's layout (empty slots) into album_pages so the builder loads it.
  const blocks = normalized ? applyBlueprint(normalized, []) : [];
  if (blocks.length > 0) {
    const { error: pagesErr } = await svc.from('album_pages').insert(blocksToPageRows(albumId, blocks));
    if (pagesErr) {
      console.error('[admin] openBlueprintForEditing pages insert error', pagesErr);
      await svc.from('albums').delete().eq('id', albumId);
      return { ok: false, error: 'Could not open the blueprint for editing.' };
    }
  }

  await audit(svc, actor.userId, 'blueprint.edit_opened', id, { albumId });
  return { ok: true, albumId };
}

/**
 * Save an edited draft album back into its SAME blueprint (0046) and regenerate the thumbnail, then
 * delete the draft. This is the "Save Blueprint" action the builder calls in edit mode. Updates the
 * layout + derived stats in place — no rebuild-from-scratch, no new blueprint row.
 */
export async function updateBlueprintFromAlbum(input: unknown): Promise<TemplateActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = UpdateBlueprintFromAlbumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId } = parsed.data;

  const svc = createServiceClient();
  // `cover_config` rides on the EXISTING album read (Phase 0). The draft's cover is now part of
  // the blueprint, so saving must capture it: reading only `album_pages`, as this action used to,
  // is exactly what discarded every cover an admin designed in Blueprint Mode.
  const { data: album } = await svc
    .from('albums')
    .select('id, user_id, blueprint_draft_of, cover_config')
    .eq('id', albumId)
    .maybeSingle();
  const a = album as { id: string; user_id: string; blueprint_draft_of: string | null; cover_config: unknown } | null;
  if (!a || !a.blueprint_draft_of) return { ok: false, error: 'This album is not a blueprint draft.' };
  if (a.user_id !== actor.userId) return { ok: false, error: 'You can only save your own blueprint draft.' };
  const blueprintId = a.blueprint_draft_of;
  const draftCover = a.cover_config ?? null;

  const { data: pageData } = await svc
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', albumId)
    .order('page_number', { ascending: true });

  type PageRow = {
    layout_template: string | null;
    caption: string | null;
    photo_ids: string[] | null;
    layout_config: { overlays?: unknown[]; texts?: unknown[]; qrs?: unknown[]; stickers?: unknown[]; background?: unknown; preset?: string } | null;
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
          preset: r.layout_config?.preset,
        }) satisfies Block,
    );
  if (blocks.length === 0) return { ok: false, error: 'Add at least one page before saving.' };

  // Blocks AND cover, in one capture. `blueprintFromBlocks` runs the cover through
  // `blueprintCoverFromConfig`, so the album's photo ids and image edits are stripped here — a
  // blueprint records the DESIGN the admin composed, never the pictures they happened to preview
  // it with. A draft with no cover_config yields a cover-less blueprint, unchanged from before.
  const bp = blueprintFromBlocks(blocks, draftCover);
  const check = BlueprintSchema.safeParse(bp);
  if (!check.success) return { ok: false, error: 'The layout could not be saved as a blueprint.' };
  const stats = blueprintStats(bp);

  const { error } = await svc
    .from('layout_templates')
    .update({
      blueprint: bp,
      page_count: stats.pageCount,
      slot_count: stats.slotCount,
      recommended_photos: stats.recommendedPhotos,
      geometry: { base: bp.blocks[0]?.template ?? 'single-pair', overlays: [] },
      updated_at: new Date().toISOString(),
      updated_by: actor.userId,
    })
    .eq('id', blueprintId)
    .not('blueprint', 'is', null);
  if (error) {
    console.error('[admin] updateBlueprintFromAlbum error', error);
    return { ok: false, error: 'Could not save the blueprint.' };
  }

  // Regenerate the thumbnail for the new layout. The draft album is kept IN PLACE so the admin can
  // keep editing after a save — it's cleaned up on Exit (exitBlueprintDraft) or on the next open.
  await startBlueprintThumbnail(blueprintId);

  await audit(svc, actor.userId, 'blueprint.updated_from_builder', blueprintId, { pageCount: stats.pageCount, slotCount: stats.slotCount });
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true, id: blueprintId };
}

/**
 * Leave Blueprint Mode — deletes the transient draft album (cascade removes its pages). If the
 * linked blueprint was never actually designed (empty blocks = an abandoned "New Blueprint"), the
 * blueprint row is removed too so the catalog isn't littered with empty drafts. Called on Exit
 * (after a save, or on discard). Best-effort; the builder navigates regardless.
 */
export async function exitBlueprintDraft(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = UpdateBlueprintFromAlbumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId } = parsed.data;

  const svc = createServiceClient();
  const { data: album } = await svc.from('albums').select('id, user_id, blueprint_draft_of').eq('id', albumId).maybeSingle();
  const a = album as { id: string; user_id: string; blueprint_draft_of: string | null } | null;
  if (!a || !a.blueprint_draft_of) return { ok: false, error: 'This album is not a blueprint draft.' };
  if (a.user_id !== actor.userId) return { ok: false, error: 'You can only exit your own blueprint draft.' };
  const blueprintId = a.blueprint_draft_of;

  // Was the blueprint ever saved? An empty blocks array = a never-designed New Blueprint.
  const { data: bpRow } = await svc.from('layout_templates').select('blueprint').eq('id', blueprintId).maybeSingle();
  const blocks = (bpRow as { blueprint: { blocks?: unknown[] } | null } | null)?.blueprint?.blocks ?? [];

  await svc.from('albums').delete().eq('id', albumId); // cascade removes album_pages
  if (Array.isArray(blocks) && blocks.length === 0) {
    await svc.from('layout_templates').delete().eq('id', blueprintId).not('blueprint', 'is', null);
    await audit(svc, actor.userId, 'blueprint.discarded', blueprintId, { reason: 'empty_draft' });
  }
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
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

/**
 * Set (or clear) the ONE default blueprint for its album size (0045). Setting a default first
 * clears any existing default for the same page_count (the partial unique index also guards this),
 * so Auto Create is deterministic. Clearing (isDefault=false) just unsets this one.
 */
export async function setDefaultBlueprint(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = SetBlueprintDefaultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, isDefault } = parsed.data;

  const svc = createServiceClient();
  const { data: row } = await svc.from('layout_templates').select('page_count').eq('id', id).not('blueprint', 'is', null).maybeSingle();
  const r = row as { page_count: number | null } | null;
  if (!r) return { ok: false, error: 'Blueprint not found.' };

  if (isDefault && r.page_count != null) {
    // Clear the current default for this size FIRST (so the unique index never trips).
    const { error: clearErr } = await svc
      .from('layout_templates')
      .update({ is_default: false })
      .eq('page_count', r.page_count)
      .not('blueprint', 'is', null)
      .eq('is_default', true);
    if (clearErr) {
      console.error('[admin] setDefaultBlueprint clear error', clearErr);
      return { ok: false, error: 'Could not update the default.' };
    }
  }

  const { error } = await svc.from('layout_templates').update({ is_default: isDefault }).eq('id', id);
  if (error) {
    console.error('[admin] setDefaultBlueprint error', error);
    return { ok: false, error: 'Could not update the default.' };
  }
  await audit(svc, actor.userId, isDefault ? 'blueprint.set_default' : 'blueprint.unset_default', id, { pageCount: r.page_count });
  revalidatePath('/admin/templates');
  bustTemplates();
  return { ok: true };
}

/** Re-run thumbnail generation for a blueprint (Step 8). Reuses the existing worker pipeline. */
export async function regenerateBlueprintThumbnail(input: unknown): Promise<TemplateSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireTemplateCapability('template:edit');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = BlueprintDeleteSchema.safeParse(input); // { id }
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  await startBlueprintThumbnail(parsed.data.id);
  await audit(createServiceClient(), actor.userId, 'blueprint.thumbnail_regenerated', parsed.data.id, {});
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
