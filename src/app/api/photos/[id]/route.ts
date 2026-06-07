import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { deleteObject } from '@/lib/r2';
import { hasPaidOrder } from '@/lib/orders/album-lock';

/**
 * DELETE /api/photos/:id
 *
 * Removes BOTH the R2 object and the photos row. Ownership is proven by selecting
 * the row through the authenticated client first: RLS returns null for a photo the
 * user doesn't own, so we never delete another user's object or row.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const idCheck = z.string().uuid().safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: 'Invalid photo id' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // RLS scopes this to the user's own photos — null means "not yours / not found".
  const { data: photo } = await supabase
    .from('photos')
    .select('id, album_id, r2_key, sanitized_key, thumb_key')
    .eq('id', params.id)
    .maybeSingle();

  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  const { album_id, r2_key, sanitized_key, thumb_key } = photo as {
    id: string;
    album_id: string | null;
    r2_key: string | null;
    sanitized_key: string | null;
    thumb_key: string | null;
  };

  // Edit lock: can't remove photos from an album that's part of a paid order.
  if (album_id && (await hasPaidOrder(supabase, album_id))) {
    return NextResponse.json(
      { error: 'This album is part of a paid order and can no longer be changed.' },
      { status: 409 },
    );
  }

  // Delete every R2 object for this photo (raw if retained, sanitized master,
  // thumbnail) before the row, so a failure leaves the row for a retry.
  const keys = [r2_key, sanitized_key, thumb_key].filter((k): k is string => !!k);
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch (err) {
      console.error('R2 delete error:', err);
      return NextResponse.json({ error: 'Could not delete file' }, { status: 502 });
    }
  }

  const { error } = await supabase.from('photos').delete().eq('id', params.id);
  if (error) {
    console.error('Photo row delete error:', error);
    return NextResponse.json({ error: 'Could not delete photo record' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
