import { createClient } from '@/lib/supabase/server';
import { normalizeCoverConfig } from '@/lib/builder/cover';
import { PAID_STATES } from '@/lib/orders/album-lock';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import CustomerShell from '@/components/customer-shell';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import Library, { type LibraryAlbum } from './_library';

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
  updated_at: string;
  cover_config: unknown;
};

export default async function DashboardPage() {
  // RLS scopes every read to the owner (user_id = auth.uid()).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Slow-read observability (Phase 10D): non-blocking — records a deduped warning only when
  // the dashboard reads cross the threshold (the new albums/orders user_id indexes target this).
  const startedAt = Date.now();
  // Hide blueprint-editing DRAFT albums (0046) from the customer library. Resilient: if the column
  // isn't migrated yet, fall back to the unfiltered query so the dashboard never breaks.
  // `cover_config` rides along on the EXISTING query — the shelf draws each album's real cover from
  // it (Phase 5), so no per-card lookup and no second round trip. It is the album's own jsonb, ~1 KB
  // each; nothing else was added.
  let albumRes = await supabase
    .from('albums')
    .select('id, title, size, status, updated_at, cover_config')
    .is('blueprint_draft_of', null)
    .order('updated_at', { ascending: false });
  if (albumRes.error) {
    albumRes = await supabase
      .from('albums')
      .select('id, title, size, status, updated_at, cover_config')
      .order('updated_at', { ascending: false });
  }
  if (albumRes.error) throw albumRes.error;
  const userAlbums = (albumRes.data ?? []) as AlbumRow[];

  // Most-recent paid order per album (RLS-scoped) — the authoritative purchase signal.
  // Keyed through ORDER_ITEMS, not `orders.album_id` (0056): an order can contain several albums
  // and that column names only the first, so keying on it would leave albums 2..N of a combined
  // purchase looking unbought — offering checkout and delete on a book the customer already owns.
  const { data: orderData } = await supabase
    .from('order_items')
    .select('album_id, orders!inner(id, status, placed_at)')
    .in('orders.status', PAID_STATES as unknown as string[]);
  type PaidLine = { album_id: string; orders: { id: string; status: string; placed_at: string } | { id: string; status: string; placed_at: string }[] };
  const paidLines = ((orderData ?? []) as unknown as PaidLine[])
    .map((r) => ({ album_id: r.album_id, order: Array.isArray(r.orders) ? r.orders[0] : r.orders }))
    .filter((r) => r.order)
    .sort((a, b) => (a.order.placed_at < b.order.placed_at ? 1 : -1));
  const purchases = new Map<string, { orderId: string; status: string; placedAt: string }>();
  for (const r of paidLines) {
    if (!purchases.has(r.album_id)) purchases.set(r.album_id, { orderId: r.order.id, status: r.order.status, placedAt: r.order.placed_at });
  }
  recordTiming('dashboard', 'albums+orders', Date.now() - startedAt, PERF_THRESHOLDS.slowQueryMs, {
    category: 'system',
    metadata: { albums: userAlbums.length },
  });

  const albums: LibraryAlbum[] = userAlbums.map((a) => ({
    id: a.id,
    title: a.title,
    size: a.size,
    status: a.status,
    updatedAt: a.updated_at,
    purchase: purchases.get(a.id) ?? null,
    // NULL stays NULL. `normalizeCoverConfig` happily invents a default config for a missing one,
    // which would make an album that has never been designed look like it has a cover — so the
    // absence is preserved here and the shelf falls back to the bound-book artwork instead.
    // Normalising server-side means the client receives an already-valid, plain-JSON CoverConfig.
    cover: a.cover_config ? normalizeCoverConfig(a.cover_config as Parameters<typeof normalizeCoverConfig>[0]) : null,
  }));

  return (
    <CustomerShell email={user?.email ?? ''}>
      {/* Opportunistic worker pre-warm (≤ once / 10 min). */}
      <WorkerPrewarm />
      <Library albums={albums} />
    </CustomerShell>
  );
}
