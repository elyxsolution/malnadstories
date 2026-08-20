import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ConfirmUploadSchema } from '@/lib/validations';
import { enqueueImageHardening } from '@/lib/queue';
import { isEditingLocked } from '@/lib/orders/album-lock';
import { checkLimit, sanitizeFilename } from '@/lib/security/guard';

/**
 * POST /api/photos/confirm
 *
 * Called by the client after a successful direct-to-R2 upload. Inserts the photos
 * row (status defaults to 'pending') via the AUTHENTICATED Supabase client so the
 * RLS check (user_id = auth.uid()) is the real DB-level gate, then enqueues the
 * image-hardening job. The raw upload is NEVER served — the worker produces
 * sanitized derivatives and the client polls until status='ready'.
 *
 * IDEMPOTENT PER UPLOAD KEY (0053). Confirming the same key twice returns the SAME
 * photo id and creates no second row. The guarantee is the DB's, not the app's: the
 * partial unique index `photos_upload_key_key` on `upload_key` decides the winner, and
 * the insert is written as ON CONFLICT DO NOTHING so the loser of a race resolves the
 * existing row instead of erroring. A SELECT-then-INSERT check would be racy and is
 * deliberately NOT the mechanism.
 *
 * `upload_key` (not `r2_key`) carries the identity because `r2_key` is transient — the
 * worker nulls it once the raw object is deleted, so it stops identifying anything.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user throttle (Phase 10C, G1). Burst-friendly; caps creation of many 'pending'
  // photo rows. Mirrors the presign limit.
  const rl = await checkLimit(`confirm:${user.id}`, 120, 60_000, {
    surface: 'upload_confirm',
    actor: { userId: user.id },
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many uploads. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
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

  // Edit lock: can't add photos to an album that's part of a paid order.
  if (await isEditingLocked(supabase, albumId)) {
    return NextResponse.json(
      { error: 'This album is part of a paid order and can no longer be changed.' },
      { status: 409 },
    );
  }

  // The key must live under this user's own album prefix. Stops a client from
  // confirming an arbitrary or someone else's object key.
  const expectedPrefix = `${user.id}/albums/${albumId}/`;
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Invalid object key' }, { status: 400 });
  }

  /**
   * Resolve the row that already owns this upload key.
   *
   * SECURITY: this must never become a way to probe for someone else's photo. Three
   * independent layers make that impossible — (1) the prefix check above proves `key`
   * begins with THIS user's id and THIS album's id, so a foreign key can't even be
   * submitted; (2) the explicit `user_id` filter; (3) RLS `users_own_photos`
   * (user_id = auth.uid()) on the authenticated client, which is the real DB gate.
   *
   * Scoped by user rather than album on purpose: `photos.album_id` is ON DELETE SET NULL,
   * so an orphaned row must still resolve to its own id rather than look absent.
   */
  const findExisting = async () =>
    supabase
      .from('photos')
      .select('id, status')
      .eq('upload_key', key)
      .eq('user_id', user.id)
      .maybeSingle();

  // Insert via the authenticated client: RLS "user_id = auth.uid()" enforces the row.
  // originalFilename is sanitized (G2 — strip control chars, collapse whitespace, cap
  // length) before storage for log/display hygiene.
  //
  // `ignoreDuplicates` makes this ON CONFLICT DO NOTHING, which needs only the INSERT
  // grant (0020/0053) — never UPDATE — so a duplicate can never rewrite the winning row's
  // filename, album, owner or upload_key. It also can't disturb `r2_key`, so a retry
  // arriving after hardening leaves the cleared key cleared.
  const { data: inserted, error } = await supabase
    .from('photos')
    .upsert(
      {
        user_id: user.id,
        album_id: albumId,
        r2_key: key,
        upload_key: key,
        original_filename: sanitizeFilename(originalFilename),
      },
      { ignoreDuplicates: true },
    )
    .select('id, status')
    .maybeSingle();

  // 23505 = unique_violation. ON CONFLICT DO NOTHING normally swallows it (returning no
  // row), but resolve it the same way if it ever surfaces as an error instead.
  if (error && error.code !== '23505') {
    console.error('Photo insert error:', error);
    return NextResponse.json({ error: 'Could not save photo' }, { status: 500 });
  }

  // No row came back → this key was already confirmed. Return the ORIGINAL photo, so a
  // retry is a no-op that yields the same id (and its real current status, which may
  // already be 'ready' or 'rejected'). Nothing is enqueued: the first confirm already
  // did, and a row whose enqueue failed is recovered by the worker's stale-pending sweep.
  if (!inserted) {
    const { data: existing, error: findErr } = await findExisting();
    if (findErr || !existing) {
      console.error('Photo confirm: upload_key conflict but no visible row', findErr);
      return NextResponse.json({ error: 'Could not save photo' }, { status: 500 });
    }
    const row = existing as { id: string; status: string };
    return NextResponse.json({ id: row.id, status: row.status });
  }

  const { id, status } = inserted as { id: string; status: string };

  // Best-effort enqueue. If it fails the row stays 'pending' and the worker's
  // periodic sweep will pick it up, so an upload is never silently lost.
  try {
    await enqueueImageHardening(id);
  } catch (e) {
    console.error('enqueue image-hardening failed (worker sweep will retry):', e);
  }

  return NextResponse.json({ id, status });
}
