'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { redirect } from 'next/navigation';
import { CreateAlbumSchema, UpdateAlbumDetailsSchema } from '@/lib/validations';
import { enqueueR2Cleanup } from '@/lib/queue';
import { hasActiveOrder, isEditingLocked } from '@/lib/orders/album-lock';
import { getActiveCoverTemplateConfig, getDefaultCoverTemplateConfig } from '@/lib/cover-templates/catalog';
import { applyCoverTemplateToAlbum } from '@/lib/cover-templates/model';
import { getActiveProduct, getDefaultProduct } from '@/lib/products/catalog';
import type { CoverConfig } from '@/lib/builder/cover';

export type AlbumActionState = { error: string } | null;
export type DeleteResult = { ok: true } | { ok: false; error: string };
export type CreateAlbumDraftResult = { ok: true; id: string } | { ok: false; error: string };

type ParsedAlbum = ReturnType<typeof CreateAlbumSchema.parse>;
type SupabaseServerClient = ReturnType<typeof createClient>;

// Bound how long the cleanup enqueue may take. pg-boss `boss.send` over the DIRECT_URL
// session pooler has no client-side timeout, so a dropped/stalled connection (Supabase
// closes idle direct connections; cold singleton; pooler hiccup) could hang the delete
// request forever. On timeout we fail fast with a retryable error (rows left intact, no
// R2 orphans) instead of stranding the caller. Mirrors withTimeout in email/send-email.
const ENQUEUE_TIMEOUT_MS = 5000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('enqueue timed out')), ms)),
  ]);
}

/**
 * Shared album-insert core — validates the chosen product + cover (both via RLS) and
 * inserts the album for the verified user. Used by BOTH the form action (createAlbum,
 * which redirects) and the wizard (createAlbumDraft, which returns the id). No new
 * behaviour: same validation, same column-scoped insert, status still server-default.
 */
async function insertAlbumForUser(
  supabase: SupabaseServerClient,
  userId: string,
  data: ParsedAlbum,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Resolve the effective (product, page count). NEW path = a physical album_products row +
  // a supported page count (0047). LEGACY path = the old `products` row (encodes the page count)
  // → mapped onto the DEFAULT product (Standard), so the current wizard keeps working unchanged.
  let pageCount: number;
  let albumProductId: string | null = null;
  // Snapshot of the resolved product's metadata, frozen onto the album at creation (0049).
  type SnapProduct = { name: string; widthCm: number; heightCm: number; printWidthCm: number; printHeightCm: number; builderAspectRatio: number };
  let snap: SnapProduct | null = null;
  const toSnap = (p: SnapProduct): SnapProduct => ({
    name: p.name,
    widthCm: p.widthCm,
    heightCm: p.heightCm,
    printWidthCm: p.printWidthCm,
    printHeightCm: p.printHeightCm,
    builderAspectRatio: p.builderAspectRatio,
  });

  if (data.albumProductId && data.pageCount) {
    const product = await getActiveProduct(data.albumProductId);
    if (!product) return { ok: false, error: 'That album is unavailable. Please choose another.' };
    if (!product.pageCounts.includes(data.pageCount)) {
      return { ok: false, error: 'That page count isn’t available for this album.' };
    }
    pageCount = data.pageCount;
    albumProductId = product.id;
    snap = toSnap(product);
  } else if (data.productId) {
    // RLS policy "public_read_active_products" already filters inactive products.
    const { data: legacy } = await supabase
      .from('products')
      .select('pages')
      .eq('id', data.productId)
      .maybeSingle();
    if (!legacy) return { ok: false, error: 'Invalid size selected. Please try again.' };
    pageCount = (legacy as { pages: number }).pages;
    const def = await getDefaultProduct();
    albumProductId = def?.id ?? null;
    if (def) snap = toSnap(def);
  } else {
    return { ok: false, error: 'Please choose an album and page count.' };
  }

  // Cover source resolution. Mutually-exclusive paths, in priority order:
  //   1. coverDesignTemplateId → copy the builder-JSON template's CoverConfig into the album
  //      (fully editable; photoIds nulled by applyCoverTemplateToAlbum). cover_template_id stays null.
  //   2. coverTemplateId → legacy uploaded-PNG cover artwork; must be an ACTIVE row.
  //   3. neither → THE admin default cover template (0052), applied exactly as path 1 —
  //      same catalog, same active + config-validity gates, same clone. The creation flow no
  //      longer asks the customer to choose; they change it freely in the builder.
  //   4. neither, and no default set → a blank custom cover (the pre-0052 behaviour, unchanged).
  let appliedCoverConfig: CoverConfig | null = null;
  if (data.coverDesignTemplateId) {
    // Read via the service-role catalog (validates + re-checks active) so a forged/inactive id
    // can't be applied; the config is deep-cloned with photo slots cleared.
    const tplConfig = await getActiveCoverTemplateConfig(data.coverDesignTemplateId);
    if (!tplConfig) return { ok: false, error: 'That cover template is unavailable. Please choose another.' };
    appliedCoverConfig = applyCoverTemplateToAlbum(tplConfig);
  } else if (data.coverTemplateId) {
    // Legacy PNG artwork must be an ACTIVE template (RLS exposes only active rows to authenticated).
    const { data: cover } = await supabase
      .from('cover_templates')
      .select('id')
      .eq('id', data.coverTemplateId)
      .eq('active', true)
      .maybeSingle();
    if (!cover) return { ok: false, error: 'That cover design is unavailable. Please choose another.' };
  } else {
    // No cover was requested — apply THE admin default, through the very same catalog and gates
    // as path 1. Best-effort by design: a missing/inactive/invalid default resolves to null and
    // the album starts blank, because creation must never fail over a cover nobody chose.
    const fallback = await getDefaultCoverTemplateConfig();
    if (fallback) appliedCoverConfig = applyCoverTemplateToAlbum(fallback.config);
  }

  // user_id from the verified JWT; status omitted → DB 'draft' default (0021). cover_template_id
  // is null for the design-template / blank paths.
  const { data: album, error: insertError } = await supabase
    .from('albums')
    .insert({
      user_id: userId,
      title: data.title,
      size: pageCount, // page count remains albums.size (backward-compatible)
      product_id: albumProductId, // physical product (0047)
      // Product snapshot at creation (0049) — historical record; rendering uses live dimensions.
      product_name: snap?.name ?? null,
      product_width_cm: snap?.widthCm ?? null,
      product_height_cm: snap?.heightCm ?? null,
      product_aspect_ratio: snap?.builderAspectRatio ?? null,
      product_print_width_cm: snap?.printWidthCm ?? null,
      product_print_height_cm: snap?.printHeightCm ?? null,
      cover_template_id: data.coverTemplateId ?? null,
      destination: data.destination ?? null,
      travel_dates: data.travelDates ?? null,
      description: data.description ?? null,
    })
    .select('id')
    .single();

  if (insertError || !album) {
    console.error('Album insert error:', insertError);
    return { ok: false, error: 'Could not create album. Please try again.' };
  }
  const albumId = (album as { id: string }).id;

  // Copy the design template's config onto the album (0038 grants authenticated UPDATE(cover_config)).
  // Best-effort: a failure here shouldn't lose the created album — the customer can re-pick in the builder.
  if (appliedCoverConfig) {
    const { error: cfgErr } = await supabase.from('albums').update({ cover_config: appliedCoverConfig }).eq('id', albumId);
    if (cfgErr) console.error('apply cover template config error (album created; cover left blank):', cfgErr);
  }

  return { ok: true, id: albumId };
}

export async function createAlbum(
  _prevState: AlbumActionState,
  formData: FormData,
): Promise<AlbumActionState> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const parsed = CreateAlbumSchema.safeParse({
    title: formData.get('title'),
    productId: formData.get('productId'),
    coverTemplateId: formData.get('coverTemplateId') || undefined,
    coverDesignTemplateId: formData.get('coverDesignTemplateId') || undefined,
    destination: formData.get('destination'),
    travelDates: formData.get('travelDates'),
    description: formData.get('description'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const res = await insertAlbumForUser(supabase, user.id, parsed.data);
  if (!res.ok) return { error: res.error };
  redirect(`/albums/${res.id}/build`);
}

/**
 * Wizard variant of createAlbum (Design Completion Phase 1). Same validated insert as
 * the form action, but RETURNS the new album id instead of redirecting — the creation
 * wizard needs the album to exist (so it can upload into it) while staying on the page.
 * Reuses the existing createAlbum flow via the shared core; additive only.
 */
export async function createAlbumDraft(input: unknown): Promise<CreateAlbumDraftResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = CreateAlbumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  return insertAlbumForUser(supabase, user.id, parsed.data);
}

export type UpdateAlbumDetailsResult = { ok: true } | { ok: false; error: string };

/**
 * Album Settings → General: update an EXISTING album's title + trip details (destination,
 * travel dates, a few words) from inside the builder. This is the "Begin" step, revisitable.
 *
 * SAFETY / SCOPE:
 *  - Metadata only. It never touches size / product / cover / status / pages / layout / photos,
 *    so it cannot affect pricing, validation, PDF, or album-creation logic (all off-limits).
 *  - Ownership is proven with the AUTHENTICATED client + RLS first; the write then goes through
 *    the service role RE-PINNED to (id, user_id), because 0021's column-scoped UPDATE grant lets
 *    `authenticated` write only (title, cover_template_id, cover_config, updated_at) — not
 *    destination/travel_dates/description. This mirrors submitAlbum's service-role status write.
 *  - Respects the edit lock: a paid album is frozen UNLESS an admin requested changes
 *    (isEditingLocked). Title changes reflect everywhere the DB title is read (dashboard,
 *    checkout, orders) after the caller refreshes.
 */
export async function updateAlbumDetails(input: unknown): Promise<UpdateAlbumDetailsResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = UpdateAlbumDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, title, destination, travelDates, description } = parsed.data;

  // Ownership gate (RLS): a foreign/nonexistent album resolves to null.
  const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };

  // Edit lock: a paid album's details are frozen (unless changes were requested).
  if (await isEditingLocked(supabase, albumId)) {
    return { ok: false, error: 'This album is part of a paid order and can no longer be changed.' };
  }

  // Service-role write re-pinned to the owner (see doc note on the 0021 grant). Empty optional
  // fields are cleared to null so removing trip details actually removes them.
  const admin = createServiceClient();
  const { error } = await admin
    .from('albums')
    .update({
      title,
      destination: destination ?? null,
      travel_dates: travelDates ?? null,
      description: description ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', albumId)
    .eq('user_id', user.id);
  if (error) {
    console.error('updateAlbumDetails error:', error);
    return { ok: false, error: 'Could not save your changes.' };
  }

  // Reflect the new title/details on the pages that read them server-side.
  revalidatePath(`/albums/${albumId}/build`);
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Permanently delete an album: its photos, saved layout, and all R2 objects.
 *
 * Ownership is enforced via the authenticated client + RLS (a non-owner's album
 * resolves to null → rejected). We gather every R2 key, hand the deletes to the
 * worker (so the request returns immediately and cleanup is reliable/retried), then
 * delete the rows. NOTE: photos.album_id is ON DELETE SET NULL, so the album cascade
 * does NOT remove photo rows — we delete them explicitly; the album cascade removes
 * album_pages and the album_pdfs row.
 */
export async function deleteAlbum(albumId: unknown): Promise<DeleteResult> {
  const parsed = z.string().uuid('Invalid album').safeParse(albumId);
  if (!parsed.success) return { ok: false, error: 'Invalid album' };
  const id = parsed.data;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Ownership gate (RLS): a foreign/nonexistent album returns null.
  const { data: album } = await supabase.from('albums').select('id').eq('id', id).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };

  // Delete lock: an album with a live order (pending or paid+) can't be deleted.
  // A pending order can be released via the checkout/confirmation "Cancel" control.
  if (await hasActiveOrder(supabase, id)) {
    return {
      ok: false,
      error: 'This album has an active order and can’t be deleted. Cancel the order first.',
    };
  }

  // Gather photo object keys (authenticated client → RLS scopes to the owner).
  const { data: photoData } = await supabase
    .from('photos')
    .select('r2_key, sanitized_key, thumb_key')
    .eq('album_id', id);
  const photoRows = (photoData ?? []) as {
    r2_key: string | null;
    sanitized_key: string | null;
    thumb_key: string | null;
  }[];

  // The preview-PDF key lives on the service-only album_pdfs row.
  const admin = createServiceClient();
  const { data: pdfRow } = await admin.from('album_pdfs').select('r2_key').eq('album_id', id).maybeSingle();

  const keys = Array.from(
    new Set(
      [
        ...photoRows.flatMap((r) => [r.r2_key, r.sanitized_key, r.thumb_key]),
        (pdfRow as { r2_key: string | null } | null)?.r2_key ?? null,
      ].filter((k): k is string => !!k),
    ),
  );

  // Hand cleanup to the worker BEFORE deleting rows. If enqueue fails we abort and
  // leave everything intact (the user can retry) rather than orphan R2 objects whose
  // keys we'd no longer be able to derive.
  if (keys.length > 0) {
    try {
      await withTimeout(enqueueR2Cleanup(keys), ENQUEUE_TIMEOUT_MS);
    } catch (e) {
      console.error('enqueue r2-cleanup failed/timed out:', e);
      return { ok: false, error: 'Could not start cleanup. Please try again.' };
    }
  }

  // Delete photo rows explicitly (FK is SET NULL, not cascade).
  const { error: photoErr } = await supabase.from('photos').delete().eq('album_id', id);
  if (photoErr) {
    console.error('delete photos error:', photoErr);
    return { ok: false, error: 'Could not delete album photos.' };
  }

  // Delete the album; cascade removes album_pages and the album_pdfs row.
  const { error: albumErr } = await supabase.from('albums').delete().eq('id', id);
  if (albumErr) {
    console.error('delete album error:', albumErr);
    return { ok: false, error: 'Could not delete album.' };
  }

  revalidatePath('/dashboard');
  return { ok: true };
}
