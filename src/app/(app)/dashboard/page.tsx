import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import AlbumCard from './_album-card';

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
  updated_at: string;
};

export default async function DashboardPage() {
  // Using the Supabase server client (anon key + user JWT) so RLS applies:
  // the albums policy "user_id = auth.uid()" filters automatically —
  // no explicit WHERE user_id = ? needed, and a bug can't leak other users' data.
  const supabase = createClient();
  // Validate the JWT against Supabase (getUser, not getSession) before querying.
  await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('albums')
    .select('id, title, size, status, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  const userAlbums = (data ?? []) as AlbumRow[];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold">My Albums</h1>
        <Button render={<Link href="/albums/new" />}>+ New album</Button>
      </div>

      <div className="mt-8">
        {userAlbums.length === 0 ? (
          <div className="rounded-lg border border-dashed p-16 text-center">
            <p className="font-medium">No albums yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first album to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {userAlbums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
