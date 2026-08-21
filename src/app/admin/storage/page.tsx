import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { HardDrive, Image as ImageIcon, FileText, Recycle, Gauge, Sparkles, Clock, Lock } from 'lucide-react';
import { requireCapability, getAdminContext } from '@/lib/auth/require-admin';
import { roleHasCapability } from '@/lib/auth/capabilities';
import { getStorageOverview, getLargestAlbums, getRetentionQueue, getCleanupHistory } from '@/lib/storage/metrics';
import { formatBytes, RETENTION_DAYS } from '@/lib/storage/model';
import { shortId, fmtDateTime } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import RetentionQueue from './_retention';

export const dynamic = 'force-dynamic';

// The heavy full-table aggregate is cached (Phase 10D pattern); the cleanup action busts
// `storage-metrics`. Queue + history stay fresh (bounded queries) so a purge reflects at once.
const cachedOverview = unstable_cache(getStorageOverview, ['storage-overview'], { tags: ['storage-metrics'], revalidate: 120 });
const cachedLargest = unstable_cache(() => getLargestAlbums(10), ['storage-largest'], { tags: ['storage-metrics'], revalidate: 120 });

const ACTION_LABEL: Record<string, string> = {
  'storage.purged_pdf': 'Deleted PDF',
  'storage.purged_photos': 'Deleted photos',
  'storage.purged_all': 'Deleted all assets',
};

export default async function StoragePage() {
  await requireCapability('storage:view');
  const ctx = await getAdminContext();
  const canManage = roleHasCapability(ctx.role, 'storage:manage');

  const [overview, largest, queue, history] = await Promise.all([
    cachedOverview(),
    cachedLargest(),
    getRetentionQueue(50),
    getCleanupHistory(30),
  ]);

  const photoPct = overview.totalBytes > 0 ? (overview.photoBytes / overview.totalBytes) * 100 : 0;
  const pdfPct = overview.totalBytes > 0 ? (overview.pdfBytes / overview.totalBytes) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-1 flex items-center gap-2">
        <HardDrive className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Storage Command Center</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Operational view of R2 usage, retention candidates, and cleanup. Sizes are{' '}
        <span className="font-medium text-foreground">estimates (≈)</span> derived from metadata — no bucket scan.
      </p>

      {/* ── Command center cards ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={HardDrive} label="Total storage used" value={`≈ ${formatBytes(overview.totalBytes)}`} sub={`${overview.photoCount + overview.pdfCount} objects (est.)`} />
        <StatCard icon={ImageIcon} label="Photos storage" value={`≈ ${formatBytes(overview.photoBytes)}`} sub={`${overview.photoCount.toLocaleString('en-IN')} photos`} />
        <StatCard icon={FileText} label="PDF storage" value={`≈ ${formatBytes(overview.pdfBytes)}`} sub={`${overview.pdfCount.toLocaleString('en-IN')} preview PDFs`} />
        <StatCard icon={Recycle} label="Eligible for cleanup" value={String(overview.eligibleAlbums)} sub={`delivered + ${RETENTION_DAYS} days`} accent />
        <StatCard icon={Recycle} label="Reclaimable space" value={`≈ ${formatBytes(overview.reclaimableBytes)}`} sub="if all eligible purged" accent />
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Gauge className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Cleanup efficiency</span>
          </div>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{Math.round(overview.efficiency * 100)}%</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, overview.efficiency * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">share of storage that is reclaimable now</p>
        </div>
      </div>

      {/* ── Distribution ─────────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Storage distribution</h2>
        <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${photoPct}%` }} title={`Photos ≈ ${formatBytes(overview.photoBytes)}`} />
          <div className="h-full bg-gold" style={{ width: `${pdfPct}%` }} title={`PDFs ≈ ${formatBytes(overview.pdfBytes)}`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <Legend swatch="bg-primary" label="Photos (master + thumb)" value={`≈ ${formatBytes(overview.photoBytes)} · ${Math.round(photoPct)}%`} />
          <Legend swatch="bg-gold" label="Preview PDFs" value={`≈ ${formatBytes(overview.pdfBytes)} · ${Math.round(pdfPct)}%`} />
          <Legend swatch="bg-muted-foreground/30" label="Other assets" value="≈ 0 B (covers excluded)" />
        </div>
      </section>

      {/* ── Largest albums ───────────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Largest albums</h2>
        {largest.length === 0 ? (
          <EmptyState title="No stored albums yet" description="Album photo + PDF storage will appear here as customers build and order." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="ms-stack w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Album</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-center">Photos</th>
                  <th className="px-3 py-2 text-center">PDF</th>
                  <th className="px-3 py-2 text-right">Est. size</th>
                </tr>
              </thead>
              <tbody>
                {largest.map((a) => (
                  <tr key={a.albumId} className="border-b last:border-0 hover:bg-muted/30">
                    <td data-label="Album" className="px-3 py-2">
                      <Link href={`/admin/albums/${a.albumId}`} className="text-primary hover:underline">{a.title ?? `#${shortId(a.albumId)}`}</Link>
                    </td>
                    <td data-label="Customer" className="px-3 py-2 text-muted-foreground">{a.customer}</td>
                    <td data-label="Photos" className="px-3 py-2 text-center tabular-nums">{a.photoCount}</td>
                    <td data-label="PDF" className="px-3 py-2 text-center text-muted-foreground">{a.hasPdf ? '✓' : '—'}</td>
                    <td data-label="Est. size" className="px-3 py-2 text-right font-medium tabular-nums">≈ {formatBytes(a.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Retention queue (eligible for cleanup) ───────────────────── */}
      <section className="mt-8">
        <div className="mb-2 flex items-center gap-2">
          <Recycle className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Eligible for cleanup</h2>
          <span className="text-xs text-muted-foreground">delivered + {RETENTION_DAYS} days · never deleted automatically</span>
        </div>
        {queue.length === 0 ? (
          <EmptyState
            title="Nothing eligible for cleanup"
            description={`Delivered orders become eligible ${RETENTION_DAYS} days after delivery. When they do, they'll appear here with their reclaimable storage.`}
          />
        ) : (
          <RetentionQueue rows={queue} canManage={canManage} />
        )}
      </section>

      {/* ── Cleanup history ──────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Cleanup history</h2>
        </div>
        {history.length === 0 ? (
          <EmptyState title="No cleanup yet" description="Every cleanup is recorded in the immutable audit trail and shown here — who, what, when, and the storage reclaimed." />
        ) : (
          <ol className="relative space-y-3 border-l pl-5">
            {history.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[23px] top-1 grid h-3 w-3 place-items-center rounded-full bg-primary ring-4 ring-background" />
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  {h.albumId && (
                    <Link href={`/admin/albums/${h.albumId}`} className="font-mono text-xs text-primary hover:underline">#{shortId(h.albumId)}</Link>
                  )}
                  {h.reclaimed > 0 && <span className="text-xs text-muted-foreground">≈ {formatBytes(h.reclaimed)} reclaimed</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{h.actor} · {fmtDateTime(h.createdAt)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Future automation (disabled placeholder) ─────────────────── */}
      <section className="mt-8 rounded-xl border border-dashed bg-muted/20 p-4 opacity-80">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Future automation</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            <Lock className="h-3 w-3" /> Coming soon
          </span>
        </div>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Automatic cleanup of eligible assets (Delivered + X days) is not enabled. The retention queue above is the
          same source a scheduler would consume — when enabled, eligible → automatic cleanup will run the exact audited
          R2-only purge admins run by hand today. No automatic deletion happens now.
        </p>
        <button type="button" disabled className="mt-3 cursor-not-allowed rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60">
          Enable automatic cleanup
        </button>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${accent ? 'ring-1 ring-primary/15' : ''}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} />
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </span>
  );
}
