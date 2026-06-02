import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { presignGet } from '@/lib/r2';

/**
 * GET /api/photos?albumId=<uuid>
 *
 * Lists an album's photos with their processing status and signed URLs for the
 * SANITIZED derivatives only (never the raw original). The builder polls this while
 * any photo is still 'pending'. RLS scopes the rows to the owner.
 */
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const albumId = new URL(request.url).searchParams.get('albumId');
  const parsed = z.string().uuid().safeParse(albumId);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid album' }, { status: 400 });
  }

  const { data } = await supabase
    .from('photos')
    .select('id, status, sanitized_key, thumb_key, taken_at')
    .eq('album_id', parsed.data)
    .order('taken_at', { ascending: true, nullsFirst: false })
    .order('uploaded_at', { ascending: true });

  type Row = {
    id: string;
    status: string;
    sanitized_key: string | null;
    thumb_key: string | null;
    taken_at: string | null;
  };

  const photos = await Promise.all(
    ((data ?? []) as Row[]).map(async (r) => ({
      id: r.id,
      status: r.status,
      takenAt: r.taken_at,
      url: r.status === 'ready' && r.sanitized_key ? await presignGet(r.sanitized_key) : '',
      thumbUrl: r.status === 'ready' && r.thumb_key ? await presignGet(r.thumb_key) : '',
    })),
  );

  return NextResponse.json({ photos });
}
