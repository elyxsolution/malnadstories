'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { redirect } from 'next/navigation';
import { CreateAlbumSchema } from '@/lib/validations';
import { enqueueR2Cleanup } from '@/lib/queue';
import { hasActiveOrder } from '@/lib/orders/album-lock';

export type AlbumActionState = { error: string } | null;
export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function createAlbum(
  _prevState: AlbumActionState,
  formData: FormData,
): Promise<AlbumActionState> {
  // Supabase server client carries the user's JWT → auth.uid() resolves in Postgres.
  // RLS enforces: albums INSERT check (user_id = auth.uid()), products SELECT (is_active = true).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const parsed = CreateAlbumSchema.safeParse({
    title: formData.get('title'),
    productId: formData.get('productId'),
    coverTemplateId: formData.get('coverTemplateId'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // RLS policy "public_read_active_products" already filters inactive products.
  // If productId is tampered or the product is inactive, this returns null.
  const { data: product } = await supabase
    .from('products')
    .select('pages')
    .eq('id', parsed.data.productId)
    .maybeSingle();

  if (!product) {
    return { error: 'Invalid size selected. Please try again.' };
  }

  // Cover is mandatory at creation and must be an ACTIVE template (RLS exposes only
  // active rows to authenticated). Never trust the client's id without this check.
  const { data: cover } = await supabase
    .from('cover_templates')
    .select('id')
    .eq('id', parsed.data.coverTemplateId)
    .eq('active', true)
    .maybeSingle();
  if (!cover) {
    return { error: 'That cover design is unavailable. Please choose another.' };
  }

  // user_id is always taken from the verified JWT session, never from form input.
  // The RLS INSERT check (user_id = auth.uid()) enforces this at the DB level too.
  const { data: album, error: insertError } = await supabase
    .from('albums')
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      size: (product as { pages: number }).pages,
      status: 'draft',
      cover_template_id: parsed.data.coverTemplateId,
    })
    .select('id')
    .single();

  if (insertError || !album) {
    console.error('Album insert error:', insertError);
    return { error: 'Could not create album. Please try again.' };
  }

  redirect(`/albums/${album.id}/build`);
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
      await enqueueR2Cleanup(keys);
    } catch (e) {
      console.error('enqueue r2-cleanup failed:', e);
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
