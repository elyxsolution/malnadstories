import Link from 'next/link';
import { Plus, Library } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { PAID_STATES } from '@/lib/orders/album-lock';
import { Button } from '@/components/ui/button';
import { LUX_PRIMARY } from '@/components/brand';
import { brandFontVars } from '@/lib/fonts';
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

  const count = userAlbums.length;
  const subtitle =
    count === 0
      ? 'Your shelf is waiting for its first story.'
      : `${count} ${count === 1 ? 'story' : 'stories'} on your shelf.`;

  return (
    <div className={`${brandFontVars} brand-surface font-ui min-h-[calc(100vh-3.5rem)]`}>
      {/* Opportunistic worker pre-warm (≤ once / 10 min) — see WorkerPrewarm. */}
      <WorkerPrewarm />
      <div className="animate-rise mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Your library</p>
            <h1 className="mt-2 font-display text-[2.4rem] font-semibold leading-none tracking-tight">Your stories</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Button render={<Link href="/albums/new" />} className={LUX_PRIMARY}>
            <Plus /> New album
          </Button>
        </div>

        <div className="mt-9">
          {userAlbums.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-20 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
                <Library className="h-6 w-6" />
              </span>
              <p className="mt-4 font-display text-xl font-semibold tracking-tight">No stories yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Every album begins with a few photos and a name. Start your first chapter.
              </p>
              <Button render={<Link href="/albums/new" />} className={`mt-6 ${LUX_PRIMARY}`}>
                <Plus /> Begin a new story
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {userAlbums.map((album) => (
                <AlbumCard key={album.id} album={album} purchase={purchases.get(album.id) ?? null} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
