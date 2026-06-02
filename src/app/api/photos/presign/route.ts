import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { PresignUploadSchema } from '@/lib/validations';
import { presignPut, ALLOWED_CONTENT_TYPES, type AllowedContentType } from '@/lib/r2';
import { photoCap } from '@/lib/builder/model';

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

  // Per-album upload cap (see photoCap: 24→50, 36→75, 48→100). RLS scopes the count.
  const cap = photoCap((album as { size: number }).size);
  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId);

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
