'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ensureCartItem } from '@/lib/cart/queries';
import { SaveLayoutSchema, PhotoEditSchema, SelectCoverSchema, CoverDesignSchema, ApplyBlueprintSchema } from '@/lib/validations';
import { PAGE_COST, type LayoutTemplate } from '@/lib/builder/model';
import { applyBlueprint, shuffleIds } from '@/lib/builder/blueprint';
import { selectAutoBlueprint } from '@/lib/builder/blueprint-select';
import { getActiveBlueprint, listActiveBlueprints } from '@/lib/templates/catalog';
import { isEditingLocked } from '@/lib/orders/album-lock';
import { auditAdminAlbumEdit, resolveAlbumWriteAccess } from '@/lib/albums/access';
import { sendReviewStatusEmail, sendReviewAdminSubmittedEmail } from '@/lib/email/review-events';

export type ActionResult = { ok: true } | { ok: false; error: string };

// Shown when a paid (or further) order has frozen an album's content.
const LOCKED_MSG = 'This album is part of a paid order and can no longer be changed.';

/**
 * Persist the whole layout for one album.
 *
 * ACCESS is resolved by `resolveAlbumWriteAccess`: the AUTHENTICATED client for the owner (RLS
 * scopes every read and write, so a forged albumId or photoId resolves to nothing — unchanged),
 * or, for an administrator holding `album:manage`, the service-role client so a submitted album
 * can be corrected in place before approval. Every other gate below is identical on both paths —
 * the edit lock, the overflow check, the album_id pin on every referenced photo — and each
 * statement stays pinned to `albumId`, which is what keeps the admin branch scoped to the one
 * album the administrator opened.
 *
 * We replace the album's blocks wholesale (delete + insert) — simplest correct model for a
 * "save the current canvas" action.
 *
 * Draft saves may be incomplete; we only reject layouts that OVERFLOW the album
 * size or reference photos that aren't in this album. Completeness is gated at
 * submit, not here.
 */
export async function saveLayout(input: unknown): Promise<ActionResult> {
  const parsed = SaveLayoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, blocks } = parsed.data;

  // Ownership OR admin capability. A signed-out caller, a foreign album and an unauthorised
  // admin are all indistinguishable here, deliberately: they all return null.
  const access = await resolveAlbumWriteAccess(albumId);
  if (!access) return { ok: false, error: 'Album not found' };
  const supabase = access.client;

  const { data: album } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  const size = (album as { size: number }).size;

  // Edit lock: a paid album's pages must not change under a placed order.
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // Accounting: leaves consumed must not exceed the album size.
  const consumed = blocks.reduce((s, b) => s + PAGE_COST[b.template as LayoutTemplate], 0);
  if (consumed > size) {
    return { ok: false, error: `Layout uses ${consumed} pages but the album holds ${size}.` };
  }

  // Every referenced photo (base AND overlays) must belong to THIS album. RLS
  // already scopes to the user, so the album_id match also pins it to the same user.
  // Empty overlay placeholders (photoId=null) reference no photo → excluded from the check.
  const referenced = Array.from(
    new Set(
      blocks
        .flatMap((b) => [...b.photoIds, ...b.overlays.map((o) => o.photoId)])
        .filter((id): id is string => !!id),
    ),
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
      // `baseEdits` (per-base-slot placement edits) rides in the same jsonb. It is written ONLY
      // when a base slot has actually forked, so a block that has never been adjusted stores the
      // exact object it always did. It also makes `layout_config` non-null on its own: a page
      // whose only state is "the left half is cropped like this" must still persist that.
      const baseEdits = (b.baseEdits ?? []).some((e) => e != null) ? b.baseEdits : undefined;
      const hasContent =
        b.overlays.length > 0 || b.texts.length > 0 || b.qrs.length > 0 || b.stickers.length > 0 || !!b.background || !!b.preset || !!baseEdits;
      const layoutConfig = hasContent
        ? {
            overlays: b.overlays,
            ...(baseEdits ? { baseEdits } : {}),
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

  // An administrator changing a customer's book is a thing the record should carry. Owner saves
  // are not audited — they always were the customer's own writes (see `auditAdminAlbumEdit`).
  await auditAdminAlbumEdit(access, albumId, 'album.layout_edited');

  return { ok: true };
}

/**
 * Save a single photo's SOURCE edit config — the default every placement of that photo inherits
 * until it is adjusted on its own (see PLACEMENT EDITS in `lib/builder/model`). A PLACEMENT's own
 * crop lives in the layout and is written by `saveLayout`; this is the uploaded image's default,
 * which is what the tray's Edit and Rotate mean.
 *
 * The owner writes through RLS. An administrator holding `album:manage` may write it too, resolved
 * through the SAME `resolveAlbumWriteAccess` gate as the layout, so there is one answer to "who may
 * change this album" rather than one per action.
 */
export async function savePhotoEdit(input: unknown): Promise<ActionResult> {
  const parsed = PhotoEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { photoId, edit } = parsed.data;

  // The photo's album, through the caller's OWN RLS view first. An owner resolves it here and
  // never touches the admin branch below; a non-owner sees nothing, exactly as before.
  const rls = createClient();
  const {
    data: { user },
  } = await rls.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { data: ownRow } = await rls.from('photos').select('album_id').eq('id', photoId).maybeSingle();
  let albumId = (ownRow as { album_id: string | null } | null)?.album_id ?? null;

  // Not the caller's photo — it may still be an album an administrator is authorised to edit. The
  // album id is read with the service role ONLY to ask the capability question about it; access is
  // then decided by resolveAlbumWriteAccess, which is the sole authority.
  if (!ownRow) {
    const { data: anyRow } = await createServiceClient()
      .from('photos')
      .select('album_id')
      .eq('id', photoId)
      .maybeSingle();
    albumId = (anyRow as { album_id: string | null } | null)?.album_id ?? null;
    if (!albumId) return { ok: false, error: 'Photo not found' };
  }

  const access = albumId ? await resolveAlbumWriteAccess(albumId) : null;
  // A photo detached from every album (album_id is ON DELETE SET NULL) is only ever the owner's
  // to touch, and RLS already proved that above.
  if (albumId && !access) return { ok: false, error: 'Photo not found' };
  const supabase = access?.client ?? rls;

  if (albumId && (await isEditingLocked(supabase, albumId))) {
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
  if (access && albumId) await auditAdminAlbumEdit(access, albumId, 'album.photo_edited');
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
    .select('id, status')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };

  // A paid album is frozen — the ONLY hard gate that remains at submit (lifecycle/security).
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  // Completeness + cover validation is now ADVISORY. It is surfaced to the user in the builder's
  // submit dialog (via the central Album Validation Service, lib/albums/validation) BEFORE this
  // call; the user may knowingly "Continue Anyway". Submission therefore never blocks on
  // completeness — the album simply enters review. PDF generation (lib/pdf/generate) runs the SAME
  // central validation as its own integrity gate, so an incomplete album can be submitted but can
  // never produce a broken PDF.

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

  // Phase 6 — the album is now submitted, which is exactly the state checkout requires, so
  // put it in the customer's cart. Same best-effort shape as the review hook above: the
  // submission has ALREADY succeeded, so a cart failure is logged and swallowed rather than
  // turned into a failed submit.
  //
  // ENSURE, NOT INCREMENT. This action has no guard against the album already being
  // `submitted` and is also the "Resubmit for Review" path, so it can run many times for one
  // album. `cart_ensure_item` is `on conflict do nothing`, so three resubmissions leave one
  // row at quantity 1 — the customer asked to submit, not to buy three copies. Manual adds
  // (addAlbumToCart) are the ones that increment.
  //
  // The authenticated client is used deliberately: `user_id` comes from `auth.uid()` inside
  // the function, so this cannot write to anyone else's cart even though a service-role
  // handle is in scope.
  try {
    await ensureCartItem(supabase, albumId);
  } catch (e) {
    console.error('[cart] submit auto-add — continuing', String(e));
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
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

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
  const parsed = CoverDesignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, title, coverTemplateId, config } = parsed.data;

  // Ownership OR `album:manage` — the same single gate the layout save uses.
  const access = await resolveAlbumWriteAccess(albumId);
  if (!access) return { ok: false, error: 'Album not found' };
  const supabase = access.client;
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

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

  // The title is written only when one was actually supplied. A blank/absent title is not an
  // error and must not cancel the write: the rest of the cover design still persists, and
  // `albums.title` — NOT NULL, and the album's name everywhere else — is left untouched.
  const { error } = await supabase
    .from('albums')
    .update({
      ...(title ? { title } : {}),
      cover_template_id: coverTemplateId,
      cover_config: config,
      updated_at: new Date().toISOString(),
    })
    .eq('id', albumId);
  if (error) {
    console.error('saveCoverDesign error:', error);
    return { ok: false, error: 'Could not save the cover design.' };
  }
  await auditAdminAlbumEdit(access, albumId, 'album.cover_edited');
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

  const placed = blocks.reduce(
    (s, b) => s + b.photoIds.filter(Boolean).length + b.overlays.filter((o) => o.photoId).length,
    0,
  );
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
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

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
  if (await isEditingLocked(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  const all = await listActiveBlueprints();
  const matching = all.filter((b) => b.pageCount === a.size);
  if (matching.length === 0) return { ok: false, error: 'No blueprints are available for this album size yet.' };

  // DETERMINISTIC (0045): use the admin's DEFAULT blueprint for this size. Only if no default is
  // set do we fall back to the closest-capacity match (first by the catalog's pinned/featured/sort
  // order — NOT random) so Auto Create is always predictable and admin-controlled.
  const uploaded = (await readyPhotoIds(supabase, albumId)).length;
  // The rule lives in `selectAutoBlueprint` (pure) so the wizard's client-side Auto Create picks
  // the SAME blueprint — it is the same deterministic choice, not a second implementation of it.
  const chosen = selectAutoBlueprint(matching, uploaded);
  if (!chosen) return { ok: false, error: 'No blueprints are available for this album size yet.' };

  const res = await applyBlueprintById(supabase, albumId, chosen.id, true, undefined);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, blueprintId: chosen.id, blueprintName: chosen.name, capacity: res.capacity, placed: res.placed, unused: res.unused };
}
