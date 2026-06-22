import { createClient } from '@/lib/supabase/server';
import { PAID_STATES } from '@/lib/orders/album-lock';
import { recordTiming } from '@/lib/observability/log';
import { PERF_THRESHOLDS } from '@/lib/observability/model';
import CustomerShell from '@/components/customer-shell';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import Library, { type LibraryAlbum } from './_library';

type AlbumRow = { id: string; title: string; size: number; status: string; updated_at: string };

export default async function DashboardPage() {
  // RLS scopes every read to the owner (user_id = auth.uid()).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Slow-read observability (Phase 10D): non-blocking — records a deduped warning only when
  // the dashboard reads cross the threshold (the new albums/orders user_id indexes target this).
  const startedAt = Date.now();
  const { data, error } = await supabase
    .from('albums')
    .select('id, title, size, status, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const userAlbums = (data ?? []) as AlbumRow[];

  // Most-recent paid order per album (RLS-scoped) — same authoritative purchase signal.
  const { data: orderData } = await supabase
    .from('orders')
    .select('id, album_id, status, placed_at')
    .in('status', PAID_STATES as unknown as string[])
    .order('placed_at', { ascending: false });
  const purchases = new Map<string, { orderId: string; status: string; placedAt: string }>();
  for (const o of (orderData ?? []) as { id: string; album_id: string; status: string; placed_at: string }[]) {
    if (!purchases.has(o.album_id)) purchases.set(o.album_id, { orderId: o.id, status: o.status, placedAt: o.placed_at });
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
  }));

  return (
    <CustomerShell email={user?.email ?? ''}>
      {/* Opportunistic worker pre-warm (≤ once / 10 min). */}
      <WorkerPrewarm />
      <Library albums={albums} />
    </CustomerShell>
  );
}
