'use server';

import { createClient } from '@/lib/supabase/server';
import { SaveLayoutSchema, PhotoEditSchema } from '@/lib/validations';
import { PAGE_COST, type LayoutTemplate } from '@/lib/builder/model';
import { hasPaidOrder } from '@/lib/orders/album-lock';

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
    const rows = blocks.map((b, i) => ({
      album_id: albumId,
      page_number: i, // sequence position, not a physical leaf
      layout_template: b.template,
      caption: b.caption || null,
      photo_ids: b.photoIds, // base slot only
      layout_config: b.overlays.length > 0 ? { overlays: b.overlays } : null,
    }));
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
    .select('id, size, status')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  const { size } = album as { size: number };

  // A paid album is frozen — no re-submitting changed content.
  if (await hasPaidOrder(supabase, albumId)) return { ok: false, error: LOCKED_MSG };

  const { data: pages } = await supabase
    .from('album_pages')
    .select('layout_template, photo_ids')
    .eq('album_id', albumId);

  const rows = (pages ?? []) as { layout_template: LayoutTemplate | null; photo_ids: string[] }[];

  let consumed = 0;
  for (const r of rows) {
    if (!r.layout_template) return { ok: false, error: 'A page is missing its layout.' };
    consumed += PAGE_COST[r.layout_template];
    const baseFilled = (r.photo_ids ?? []).filter(Boolean).length >= 1;
    if (!baseFilled) {
      return { ok: false, error: 'Every page must have its main photo before submitting.' };
    }
  }
  if (consumed !== size) {
    return { ok: false, error: `Album must fill exactly ${size} pages (currently ${consumed}).` };
  }

  const { error } = await supabase
    .from('albums')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .eq('id', albumId);
  if (error) {
    console.error('submitAlbum error:', error);
    return { ok: false, error: 'Could not submit album.' };
  }
  return { ok: true };
}
