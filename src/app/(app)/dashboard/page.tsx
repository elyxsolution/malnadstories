import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { albums } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userAlbums = await db
    .select({
      id: albums.id,
      title: albums.title,
      size: albums.size,
      status: albums.status,
      updatedAt: albums.updatedAt,
    })
    .from(albums)
    .where(eq(albums.userId, user!.id))
    .orderBy(desc(albums.updatedAt));

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
              <Link
                key={album.id}
                href={`/albums/${album.id}/build`}
                className="block"
              >
                <Card className="h-full hover:ring-2 hover:ring-foreground/20 transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-base">{album.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{album.size} pages</p>
                    <p className="text-xs mt-1 capitalize text-muted-foreground">
                      {album.status}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
