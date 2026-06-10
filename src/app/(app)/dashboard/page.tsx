import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PAID_STATES } from '@/lib/orders/album-lock';
import { Button } from '@/components/ui/button';
import AlbumCard, { type Purchase } from './_album-card';
import WorkerPrewarm from '@/components/worker/worker-prewarm';

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

  // Purchase records (RLS-scoped): the authoritative "this album is paid" signal is
  // orders.status ∈ PAID_STATES — the same source the edit/checkout locks use. Map
  // each album to its most recent paid order so cards can show ✓ Purchased + status.
  const { data: orderData } = await supabase
    .from('orders')
    .select('id, album_id, status, placed_at')
    .in('status', PAID_STATES as unknown as string[])
    .order('placed_at', { ascending: false });
  const orders = (orderData ?? []) as {
    id: string;
    album_id: string;
    status: string;
    placed_at: string;
  }[];

  const purchases = new Map<string, Purchase>();
  for (const o of orders) {
    if (!purchases.has(o.album_id)) {
      purchases.set(o.album_id, {
        orderId: o.id,
        status: o.status,
        placedAt: o.placed_at,
        pdfReady: false,
      });
    }
  }

  // Preview-PDF availability for purchased albums (album_pdfs is service-only;
  // ownership already proven by the RLS-scoped orders read above). Drives the
  // dashboard "Download" action.
  const purchasedIds = Array.from(purchases.keys());
  if (purchasedIds.length > 0) {
    const admin = createServiceClient();
    const { data: pdfData } = await admin
      .from('album_pdfs')
      .select('album_id, status')
      .in('album_id', purchasedIds)
      .eq('status', 'ready');
    for (const row of (pdfData ?? []) as { album_id: string; status: string }[]) {
      const p = purchases.get(row.album_id);
      if (p) p.pdfReady = true;
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Opportunistic worker pre-warm (≤ once / 10 min) — see WorkerPrewarm. */}
      <WorkerPrewarm />
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
              <AlbumCard key={album.id} album={album} purchase={purchases.get(album.id) ?? null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
