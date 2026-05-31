import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { albums } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export default async function BuildPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layout guarantees auth, but also needed to scope the ownership check below
  if (!user) notFound();

  // Ownership check: album must exist AND belong to this user
  const [album] = await db
    .select()
    .from(albums)
    .where(and(eq(albums.id, params.id), eq(albums.userId, user.id)))
    .limit(1);

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

      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{album.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">
            {album.size} pages · {album.status}
          </p>
        </div>
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
