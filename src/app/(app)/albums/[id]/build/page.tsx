import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
};

export default async function BuildPage({ params }: { params: { id: string } }) {
  // Supabase server client: RLS policy "user_id = auth.uid()" scopes the SELECT.
  // If the album belongs to someone else, or doesn't exist, data is null → 404.
  // No explicit AND(id, userId) needed — RLS is the gate.
  const supabase = createClient();

  const { data } = await supabase
    .from('albums')
    .select('id, title, size, status')
    .eq('id', params.id)
    .maybeSingle();

  const album = data as AlbumRow | null;
  if (!album) notFound();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        {' / '}
        {album.title}
      </p>

      <div className="mt-2">
        <h1 className="text-2xl font-bold">{album.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground capitalize">
          {album.size} pages · {album.status}
        </p>
      </div>

      <div className="mt-8 rounded-lg border border-dashed p-16 text-center text-muted-foreground">
        <p className="font-medium">Builder coming soon</p>
        <p className="mt-1 text-sm">
          Photo upload and page arrangement will be here in the next session.
        </p>
      </div>
    </div>
  );
}
