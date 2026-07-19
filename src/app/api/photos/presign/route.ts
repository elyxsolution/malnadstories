import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { PresignUploadSchema } from '@/lib/validations';
import { presignPut, ALLOWED_CONTENT_TYPES, type AllowedContentType } from '@/lib/r2';
import { photoCap } from '@/lib/builder/model';
import { isEditingLocked } from '@/lib/orders/album-lock';
import { workerConfigOk } from '@/lib/worker/health';
import { checkLimit } from '@/lib/security/guard';

/**
 * POST /api/photos/presign
 *
 * Returns a short-lived presigned PUT URL so the browser can upload a file
 * directly to R2. NOTHING here is trusted from the client: the user must own the
 * album, the type must be allowed, the size must be within the cap, and the album
 * must not already be full. The signature pins content-type + content-length.
 */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user mint throttle (Phase 10C). Burst-friendly so genuine bulk uploads are
  // unaffected; caps a client minting unbounded presigned URLs. (photoCap already
  // bounds usable rows; this caps churn/abuse.)
  const rl = await checkLimit(`presign:${user.id}`, 120, 60_000, {
    surface: 'upload_presign',
    actor: { userId: user.id },
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Fail-closed in production: every uploaded photo MUST be hardened by the worker
  // before it's usable, so refuse to even mint an upload URL when the worker is
  // unconfigured (a broken deploy). Cheap + network-free; in dev this is a no-op.
  // (The transient "worker asleep" case is handled by the client wake-up gate before
  // upload, and the worker's sweep is the eventual backstop.)
  if (!workerConfigOk()) {
    return NextResponse.json(
      { error: 'Photo processing is temporarily unavailable. Please try again later.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = PresignUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { albumId, contentType, size } = parsed.data;

  // Ownership gate: RLS scopes this SELECT to the user's own albums. A foreign or
  // non-existent album returns null → reject. Never trust the client's claim.
  const { data: album } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

  // Edit lock: a purchased album is frozen. The state-changing step (confirm) already
  // enforces this; we also reject at presign so a paid album can't even mint upload
  // URLs (no orphaned R2 objects, no wasted work). Same paid signal everywhere.
  if (await isEditingLocked(supabase, albumId)) {
    return NextResponse.json(
      { error: 'This album is part of a paid order and can no longer be changed.' },
      { status: 403 },
    );
  }

  // Per-album upload cap (see photoCap: 24→50, 36→75, 48→100). RLS scopes the count.
  // Rejected uploads don't count — they never become usable, so they shouldn't
  // consume a slot.
  const cap = photoCap((album as { size: number }).size);
  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId)
    .neq('status', 'rejected');

  if ((count ?? 0) >= cap) {
    return NextResponse.json(
      { error: `This album is full (${cap} photos max).` },
      { status: 409 },
    );
  }

  const ext = ALLOWED_CONTENT_TYPES[contentType as AllowedContentType];
  const key = `${user.id}/albums/${albumId}/${randomUUID()}.${ext}`;

  const url = await presignPut({
    key,
    contentType: contentType as AllowedContentType,
    contentLength: size,
  });

  return NextResponse.json({ url, key });
}
