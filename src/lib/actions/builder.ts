'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { SaveLayoutSchema, PhotoEditSchema, SelectCoverSchema, CoverDesignSchema, ApplyBlueprintSchema } from '@/lib/validations';
import { PAGE_COST, requiredBaseCount, type LayoutTemplate } from '@/lib/builder/model';
import { normalizeCoverConfig } from '@/lib/builder/cover';
import { applyBlueprint, shuffleIds } from '@/lib/builder/blueprint';
import { getActiveBlueprint, listActiveBlueprints } from '@/lib/templates/catalog';
import { hasPaidOrder } from '@/lib/orders/album-lock';
import { sendReviewStatusEmail, sendReviewAdminSubmittedEmail } from '@/lib/email/review-events';

export type ActionResult = { ok: true } | { ok: false; error: string };

// Shown when a paid (or further) order has frozen an album's content.
const LOCKED_MSG = 'This album is part of a paid order and can no longer be changed.';

/**
 * Persist the whole layout for one album.
 *
 * All access is through the AUTHENTICATED Supabase client: RLS scopes every read
 * and write to the album's owner, so a forged albumId or photoId simply resolves
 * to nothing. We replace the album's blocks wholesale (delete + insert) — simplest
 * correct model for a "save the current canvas" action.
 *
 * Draft saves may be incomplete; we only reject layouts that OVERFLOW the album
 * size or reference photos that aren't in this album. Completeness is gated at
 * submit, not here.
 */
export async function saveLayout(input: unknown): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = SaveLayoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, blocks } = parsed.data;

  // Ownership gate (RLS): a foreign/nonexistent album returns null.
  const { data: album } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  const size = (album as { size: number }).size;

  // Edit lock: a paid album's pages must not change under a placed order.
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // Accounting: leaves consumed must not exceed the album size.
  const consumed = blocks.reduce((s, b) => s + PAGE_COST[b.template as LayoutTemplate], 0);
  if (consumed > size) {
    return { ok: false, error: `Layout uses ${consumed} pages but the album holds ${size}.` };
  }

  // Every referenced photo (base AND overlays) must belong to THIS album. RLS
  // already scopes to the user, so the album_id match also pins it to the same user.
  const referenced = Array.from(
    new Set(blocks.flatMap((b) => [...b.photoIds, ...b.overlays.map((o) => o.photoId)])),
  );
  if (referenced.length > 0) {
    const { data: owned } = await supabase
      .from('photos')
      .select('id')
      .eq('album_id', albumId)
      .in('id', referenced);
    const ownedIds = new Set((owned ?? []).map((p) => (p as { id: string }).id));
    if (referenced.some((id) => !ownedIds.has(id))) {
      return { ok: false, error: 'A selected photo does not belong to this album.' };
    }
  }

  // Replace the album's blocks. delete-all + insert keeps page_number authoritative
  // and avoids diffing; both statements are RLS-scoped to the owner.
  const { error: delErr } = await supabase.from('album_pages').delete().eq('album_id', albumId);
  if (delErr) {
    console.error('saveLayout delete error:', delErr);
    return { ok: false, error: 'Could not save layout.' };
  }

  if (blocks.length > 0) {
    const rows = blocks.map((b, i) => {
      // layout_config holds overlays + the rich elements (texts / qrs / background).
      // The DB CHECK (0006) requires `overlays` to be an array whenever the object is
      // non-null, so we always include it when storing ANY element; otherwise store null.
      const hasContent =
        b.overlays.length > 0 || b.texts.length > 0 || b.qrs.length > 0 || b.stickers.length > 0 || !!b.background || !!b.preset;
      const layoutConfig = hasContent
        ? {
            overlays: b.overlays,
            ...(b.texts.length > 0 ? { texts: b.texts } : {}),
            ...(b.qrs.length > 0 ? { qrs: b.qrs } : {}),
            ...(b.stickers.length > 0 ? { stickers: b.stickers } : {}),
            ...(b.background ? { background: b.background } : {}),
            ...(b.preset ? { preset: b.preset } : {}),
          }
        : null;
      return {
        album_id: albumId,
        page_number: i, // sequence position, not a physical leaf
        layout_template: b.template,
        caption: b.caption || null,
        photo_ids: b.photoIds, // base slot only
        layout_config: layoutConfig,
      };
    });
    const { error: insErr } = await supabase.from('album_pages').insert(rows);
    if (insErr) {
      console.error('saveLayout insert error:', insErr);
      return { ok: false, error: 'Could not save layout.' };
    }
  }

  return { ok: true };
}

/** Save a single photo's non-destructive edit config. RLS scopes to the owner. */
export async function savePhotoEdit(input: unknown): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = PhotoEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { photoId, edit } = parsed.data;

  // Resolve the photo's album (RLS scopes to the owner) so we can enforce the edit
  // lock: a paid album's photo edits must not change under a placed order.
  const { data: photoRow } = await supabase
    .from('photos')
    .select('album_id')
    .eq('id', photoId)
    .maybeSingle();
  const albumId = (photoRow as { album_id: string | null } | null)?.album_id ?? null;
  if (!photoRow) return { ok: false, error: 'Photo not found' };
  if (albumId && (await hasPaidOrder(supabase, albumId))) {
    return { ok: false, error: LOCKED_MSG };
  }

  const { data: updated, error } = await supabase
    .from('photos')
    .update({ edit_config: edit })
    .eq('id', photoId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('savePhotoEdit error:', error);
    return { ok: false, error: 'Could not save edit.' };
  }
  if (!updated) return { ok: false, error: 'Photo not found' };
  return { ok: true };
}

/**
 * Finalize the album. Re-reads the saved layout from the DB (never trusts the
 * client for the gate), requires leaves == size with every BASE slot filled
 * (overlays are optional), then flips status to 'submitted'. Submitted albums stay
 * editable until an order is placed (a later slice), so this is just the marker.
 */
export async function submitAlbum(albumId: unknown): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  if (typeof albumId !== 'string') return { ok: false, error: 'Invalid album' };

  const { data: album } = await supabase
    .from('albums')
    .select('id, size, status, cover_template_id, cover_config')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  const { size, cover_template_id, cover_config } = album as {
    size: number;
    cover_template_id: string | null;
    cover_config: unknown;
  };

  // A paid album is frozen — no re-submitting changed content.
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // Cover is mandatory (physical page 1). It's satisfied by an active base template OR a
  // custom cover (an uploaded photo / a background) — the custom designer can stand alone.
  const cfg = normalizeCoverConfig(cover_config as Parameters<typeof normalizeCoverConfig>[0]);
  const hasCustomCover = !!cfg.photoId || !!cfg.background;
  let hasActiveTemplate = false;
  if (cover_template_id) {
    const { data: cover } = await supabase
      .from('cover_templates')
      .select('id')
      .eq('id', cover_template_id)
      .eq('active', true)
      .maybeSingle();
    hasActiveTemplate = !!cover;
  }
  if (!hasActiveTemplate && !hasCustomCover) {
    return { ok: false, error: 'Add a cover design before submitting (a template, a photo, or a background).' };
  }

  const { data: pages } = await supabase
    .from('album_pages')
    .select('layout_template, photo_ids')
    .eq('album_id', albumId);

  const rows = (pages ?? []) as { layout_template: LayoutTemplate | null; photo_ids: string[] }[];

  let consumed = 0;
  for (const r of rows) {
    if (!r.layout_template) return { ok: false, error: 'A page is missing its layout.' };
    consumed += PAGE_COST[r.layout_template];
    // single-pair needs BOTH pages filled; double-spread needs its one image.
    const filled = (r.photo_ids ?? []).filter(Boolean).length;
    if (filled < requiredBaseCount(r.layout_template)) {
      return {
        ok: false,
        error:
          r.layout_template === 'single-pair'
            ? 'Every single page needs a photo on both the left and right.'
            : 'Every double-page spread needs its image.',
      };
    }
  }
  if (consumed !== size) {
    return { ok: false, error: `Album must fill exactly ${size} content pages (currently ${consumed}).` };
  }

  // status='submitted' is a SERVER-CONTROLLED transition (0021): `authenticated` no
  // longer holds an UPDATE grant on albums.status, so this write goes through the
  // service role — AFTER the RLS-scoped ownership + completeness checks above. We
  // re-pin user_id + id so the service-role write can only touch THIS owner's album
  // (belt-and-suspenders, mirroring cancelOrder), and require the album to still be a
  // draft/submitted (never resurrecting a different lifecycle).
  const admin = createServiceClient();
  const { error } = await admin
    .from('albums')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .eq('id', albumId)
    .eq('user_id', user.id);
  if (error) {
    console.error('submitAlbum error:', error);
    return { ok: false, error: 'Could not submit album.' };
  }

  // Phase 9C — enter / re-enter the parallel ADVISORY review workflow. This is purely
  // additive: it creates or resets the album_reviews row to 'pending_review' (and resets
  // any active revision to 'resubmitted'), and notifies. It NEVER gates checkout and
  // never touches orders/payments/PDF/fulfilment. Best-effort: a failure here must not
  // break the (already successful) submit. Covers both first submit and resubmit.
  try {
    await admin.rpc('submit_album_for_review', { p_album_id: albumId, p_customer_id: user.id });
    await Promise.all([
      sendReviewAdminSubmittedEmail(albumId),
      sendReviewStatusEmail(albumId, 'pending_review'),
    ]);
  } catch (e) {
    console.error('[review] submit hook — continuing', String(e));
  }

  return { ok: true };
}

/**
 * Set the album's cover design (an admin-managed template). The cover is chosen, never
 * edited — users can't put photos on it. RLS scopes the album to the owner; we verify
 * the template exists and is active. Blocked once the album is part of a paid order.
 */
export async function selectCover(input: unknown): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = SelectCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, coverTemplateId } = parsed.data;

  // Ownership gate (RLS).
  const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // The cover must be a real, active template (active rows are SELECT-visible via RLS).
  const { data: cover } = await supabase
    .from('cover_templates')
    .select('id')
    .eq('id', coverTemplateId)
    .eq('active', true)
    .maybeSingle();
  if (!cover) return { ok: false, error: 'That cover is no longer available.' };

  const { error } = await supabase
    .from('albums')
    .update({ cover_template_id: coverTemplateId, updated_at: new Date().toISOString() })
    .eq('id', albumId);
  if (error) {
    console.error('selectCover error:', error);
    return { ok: false, error: 'Could not save the cover selection.' };
  }
  return { ok: true };
}

/**
 * Persist the full custom cover DESIGN: title (cover line 1), an optional base template,
 * and the cover_config (subtitle, typography, layout, position, background, photo source).
 * Authenticated client + RLS scopes to the owner; blocked once the album is part of a paid
 * order. The base template and any chosen cover photo are re-verified server-side. Writes
 * `albums.cover_config` (0038) — until that migration runs this single write fails cleanly.
 */
export async function saveCoverDesign(input: unknown): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = CoverDesignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, title, coverTemplateId, config } = parsed.data;

  // Ownership gate (RLS).
  const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // A chosen base template must be a real, active cover.
  if (coverTemplateId) {
    const { data: cover } = await supabase
      .from('cover_templates')
      .select('id')
      .eq('id', coverTemplateId)
      .eq('active', true)
      .maybeSingle();
    if (!cover) return { ok: false, error: 'That cover is no longer available.' };
  }

  // A chosen cover photo must belong to THIS album and be processed (RLS scopes to owner).
  if (config.photoId) {
    const { data: p } = await supabase
      .from('photos')
      .select('id')
      .eq('id', config.photoId)
      .eq('album_id', albumId)
      .eq('status', 'ready')
      .maybeSingle();
    if (!p) return { ok: false, error: 'That photo is not available for the cover.' };
  }

  const { error } = await supabase
    .from('albums')
    .update({ title, cover_template_id: coverTemplateId, cover_config: config, updated_at: new Date().toISOString() })
    .eq('id', albumId);
  if (error) {
    console.error('saveCoverDesign error:', error);
    return { ok: false, error: 'Could not save the cover design.' };
  }
  return { ok: true };
}

// ── Album Blueprints (0043) — apply to an album (Phase C) ──────────────────────
// Applying a blueprint PRODUCES ordinary Block[] (photos assigned to base+overlay slots) and
// persists via the SAME saveLayout below — so ownership, edit-lock, placed-once, overflow, and
// the renderer/PDF/worker are all reused unchanged. Auto-place is optional; a seed makes the
// randomized fill reproducible. Never overwrites a paid album (edit lock).

export type ApplyBlueprintResult =
  | { ok: true; blueprintId: string; capacity: number; placed: number; unused: number }
  | { ok: false; error: string };

type ServerClient = ReturnType<typeof createClient>;

/** Ready photo ids in display order (taken_at asc, nulls last), RLS-scoped to the owner. */
async function readyPhotoIds(supabase: ServerClient, albumId: string): Promise<string[]> {
  const { data } = await supabase
    .from('photos')
    .select('id')
    .eq('album_id', albumId)
    .eq('status', 'ready')
    .order('taken_at', { ascending: true, nullsFirst: false })
    .order('uploaded_at', { ascending: true });
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function applyBlueprintById(
  supabase: ServerClient,
  albumId: string,
  blueprintId: string,
  autoPlace: boolean,
  seed: number | undefined,
): Promise<ApplyBlueprintResult> {
  const bp = await getActiveBlueprint(blueprintId);
  if (!bp) return { ok: false, error: 'That blueprint is no longer available.' };

  const ready = autoPlace ? await readyPhotoIds(supabase, albumId) : [];
  const ordered = autoPlace && seed !== undefined ? shuffleIds(ready, seed) : ready;
  const blocks = applyBlueprint(bp.blueprint, ordered);

  const res = await saveLayout({
    albumId,
    blocks: blocks.map((b) => ({
      template: b.template,
      photoIds: b.photoIds,
      caption: b.caption,
      overlays: b.overlays,
      texts: b.texts,
      qrs: b.qrs,
      stickers: b.stickers,
      background: b.background,
    })),
  });
  if (!res.ok) return { ok: false, error: res.error };

  const placed = blocks.reduce((s, b) => s + b.photoIds.filter(Boolean).length + b.overlays.length, 0);
  return { ok: true, blueprintId, capacity: bp.slotCount, placed, unused: Math.max(0, ready.length - placed) };
}

/** Option 2: apply a chosen blueprint (with optional auto-place). */
export async function applyBlueprintToAlbum(input: unknown): Promise<ApplyBlueprintResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = ApplyBlueprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, blueprintId, autoPlace, seed } = parsed.data;

  const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  return applyBlueprintById(supabase, albumId, blueprintId, autoPlace, seed);
}

export type AutoSelectBlueprintResult =
  | { ok: true; blueprintId: string; blueprintName: string; capacity: number; placed: number; unused: number }
  | { ok: false; error: string };

/**
 * Option 1: auto-select the best-fit blueprint for the album's page count + uploaded photo count,
 * then apply it. Filters active blueprints to the album's exact page count, chooses the CLOSEST
 * capacity to the uploaded count, and breaks ties RANDOMLY. Always auto-places.
 */
export async function autoSelectAndApplyBlueprint(input: unknown): Promise<AutoSelectBlueprintResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = ApplyBlueprintSchema.pick({ albumId: true }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId } = parsed.data;

  const { data: album } = await supabase.from('albums').select('id, size').eq('id', albumId).maybeSingle();
  const a = album as { id: string; size: number } | null;
  if (!a) return { ok: false, error: 'Album not found' };
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  const all = await listActiveBlueprints();
  const matching = all.filter((b) => b.pageCount === a.size);
  if (matching.length === 0) return { ok: false, error: 'No blueprints are available for this album size yet.' };

  // DETERMINISTIC (0045): use the admin's DEFAULT blueprint for this size. Only if no default is
  // set do we fall back to the closest-capacity match (first by the catalog's pinned/featured/sort
  // order — NOT random) so Auto Create is always predictable and admin-controlled.
  const uploaded = (await readyPhotoIds(supabase, albumId)).length;
  const chosen =
    matching.find((b) => b.isDefault) ??
    matching.reduce((best, b) => (Math.abs(b.slotCount - uploaded) < Math.abs(best.slotCount - uploaded) ? b : best), matching[0]);

  const res = await applyBlueprintById(supabase, albumId, chosen.id, true, undefined);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, blueprintId: chosen.id, blueprintName: chosen.name, capacity: res.capacity, placed: res.placed, unused: res.unused };
}
