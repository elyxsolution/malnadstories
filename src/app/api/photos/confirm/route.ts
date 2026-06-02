import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ConfirmUploadSchema } from '@/lib/validations';
import { enqueueImageHardening } from '@/lib/queue';

/**
 * POST /api/photos/confirm
 *
 * Called by the client after a successful direct-to-R2 upload. Inserts the photos
 * row (status defaults to 'pending') via the AUTHENTICATED Supabase client so the
 * RLS check (user_id = auth.uid()) is the real DB-level gate, then enqueues the
 * image-hardening job. The raw upload is NEVER served — the worker produces
 * sanitized derivatives and the client polls until status='ready'.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = ConfirmUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { albumId, key, originalFilename } = parsed.data;

  // Re-verify ownership (RLS scopes the SELECT) — confirm is a separate request and
  // must not assume the presign step already happened for this user.
  const { data: album } = await supabase
    .from('albums')
    .select('id')
    .eq('id', albumId)
    .maybeSingle();

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

  // The key must live under this user's own album prefix. Stops a client from
  // confirming an arbitrary or someone else's object key.
  const expectedPrefix = `${user.id}/albums/${albumId}/`;
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Invalid object key' }, { status: 400 });
  }

  // Insert via the authenticated client: RLS "user_id = auth.uid()" enforces the row.
  const { data: photo, error } = await supabase
    .from('photos')
    .insert({
      user_id: user.id,
      album_id: albumId,
      r2_key: key,
      original_filename: originalFilename,
    })
    .select('id')
    .single();

  if (error || !photo) {
    console.error('Photo insert error:', error);
    return NextResponse.json({ error: 'Could not save photo' }, { status: 500 });
  }

  const id = (photo as { id: string }).id;

  // Best-effort enqueue. If it fails the row stays 'pending' and the worker's
  // periodic sweep will pick it up, so an upload is never silently lost.
  try {
    await enqueueImageHardening(id);
  } catch (e) {
    console.error('enqueue image-hardening failed (worker sweep will retry):', e);
  }

  return NextResponse.json({ id, status: 'pending' });
}
