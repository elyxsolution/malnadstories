import Link from 'next/link';
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, or, sum } from 'drizzle-orm';
import { AlertTriangle, ImageOff, FileWarning, Clock } from 'lucide-react';
import { db } from '@/db';
import { orders, coupons, couponRedemptions, albums, profiles, photos, albumPdfs } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { roleHasCapability } from '@/lib/auth/capabilities';
import { collectHealth } from '@/lib/monitoring/collectors';
import { serviceLabel, healthChip, worstHealth, type HealthStatus } from '@/lib/monitoring/model';
import { adminUserEmails } from '@/lib/admin/users';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import { adminStatusLabel } from '@/lib/orders/status';

const PAID_FAMILY = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'];
const AWAITING = ['paid', 'processing', 'printing', 'packed'];
const QUEUE_STATES = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'] as const;

export default async function AdminDashboard() {
  const ctx = await requireAdmin();

  // Compact system-health strip — only for roles with monitoring:view (content sees nothing
  // new; no extra queries run for them). Read-only; the full view lives at /admin/monitoring.
  const showHealth = roleHasCapability(ctx.role, 'monitoring:view');
  // Best-effort: a collector failure must NEVER blank the whole dashboard — degrade the
  // health strip to empty instead of throwing the page render.
  let health: Awaited<ReturnType<typeof collectHealth>> = [];
  if (showHealth) {
    try {
      health = await collectHealth();
    } catch (e) {
      console.error('[admin] dashboard health strip failed — degrading', String(e));
    }
  }
  const healthOverall = worstHealth(health.map((h) => h.status as HealthStatus));

  const now = new Date();

  const [
    [{ revenue }],
    [{ totalOrders }],
    [{ awaiting }],
    [{ delivered }],
    [{ activeCoupons }],
    [{ couponsUsed }],
    recent,
  ] = await Promise.all([
    db.select({ revenue: sum(orders.totalAmount) }).from(orders).where(inArray(orders.status, PAID_FAMILY)),
    db.select({ totalOrders: count() }).from(orders),
    db.select({ awaiting: count() }).from(orders).where(inArray(orders.status, AWAITING)),
    db.select({ delivered: count() }).from(orders).where(eq(orders.status, 'delivered')),
    db
      .select({ activeCoupons: count() })
      .from(coupons)
      .where(
        and(
          eq(coupons.active, true),
          lte(coupons.startsAt, now),
          or(isNull(coupons.expiresAt), gte(coupons.expiresAt, now)),
        ),
      ),
    db.select({ couponsUsed: count() }).from(couponRedemptions),
    db
      .select({
        id: orders.id,
        status: orders.status,
        total: orders.totalAmount,
        placedAt: orders.placedAt,
        userId: orders.userId,
        customerName: profiles.name,
        albumTitle: albums.title,
      })
      .from(orders)
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .leftJoin(profiles, eq(orders.userId, profiles.id))
      .orderBy(desc(orders.placedAt))
      .limit(10),
  ]);

  const emails = await adminUserEmails(recent.map((r) => r.userId));

  // ── Live queue snapshot + alerts (read-only over existing data) ──────────────
  const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const [statusRows, rejectedRow, failedPdfRow, stuckPdfRow] = await Promise.all([
    db.select({ status: orders.status, c: count() }).from(orders).groupBy(orders.status),
    db.select({ c: count() }).from(photos).where(eq(photos.status, 'rejected')),
    db.select({ c: count() }).from(albumPdfs).where(eq(albumPdfs.status, 'failed')),
    db
      .select({ c: count() })
      .from(albumPdfs)
      .where(and(eq(albumPdfs.status, 'generating'), lt(albumPdfs.requestedAt, stuckCutoff))),
  ]);
  const statusCount = new Map(statusRows.map((r) => [r.status, r.c]));
  const queue = QUEUE_STATES.map((s) => ({ status: s, label: adminStatusLabel(s), count: statusCount.get(s) ?? 0 }));
  const rejectedPhotos = rejectedRow[0]?.c ?? 0;
  const failedPdfs = failedPdfRow[0]?.c ?? 0;
  const stuckPdfs = stuckPdfRow[0]?.c ?? 0;

  const alerts: { icon: typeof AlertTriangle; color: string; title: string; detail: string; href: string }[] = [];
  if (rejectedPhotos > 0)
    alerts.push({ icon: ImageOff, color: 'text-warning', title: `${rejectedPhotos} photo${rejectedPhotos === 1 ? '' : 's'} failed processing`, detail: 'Rejected during image hardening (spoofed/undecodable/too large).', href: '/admin/system' });
  if (failedPdfs > 0)
    alerts.push({ icon: FileWarning, color: 'text-destructive', title: `${failedPdfs} PDF generation${failedPdfs === 1 ? '' : 's'} failed`, detail: 'Album preview PDFs that ended in a failed state.', href: '/admin/system' });
  if (stuckPdfs > 0)
    alerts.push({ icon: Clock, color: 'text-warning', title: `${stuckPdfs} PDF${stuckPdfs === 1 ? '' : 's'} stuck generating`, detail: 'Generating for over 5 minutes — the worker sweep should recover these.', href: '/admin/system' });

  const cards = [
    { label: 'Total revenue', value: inr(revenue ?? 0) },
    { label: 'Total orders', value: String(totalOrders) },
    { label: 'Awaiting fulfilment', value: String(awaiting), href: '/admin/orders?status=paid' },
    { label: 'Delivered', value: String(delivered), href: '/admin/orders?status=delivered' },
    { label: 'Active coupons', value: String(activeCoupons), href: '/admin/coupons' },
    { label: 'Coupons used', value: String(couponsUsed) },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => {
          const inner = (
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-xl font-semibold">{c.value}</p>
            </div>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} className="block hover:opacity-80">
              {inner}
            </Link>
          ) : (
            <div key={c.label}>{inner}</div>
          );
        })}
      </div>

      {showHealth && (
        <Link
          href="/admin/monitoring"
          className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/30"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            System health
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${healthChip(healthOverall)}`}>
              {healthOverall}
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {health.map((h) => (
              <span
                key={h.service}
                title={`${serviceLabel(h.service)}: ${h.message}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${healthChip(h.status)}`}
              >
                {serviceLabel(h.service)}
              </span>
            ))}
          </span>
          <span className="ml-auto text-xs text-primary">Open monitoring →</span>
        </Link>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Live queue */}
        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">Live queue</h2>
            <Link href="/admin/production" className="text-xs text-primary hover:underline">
              Production board →
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-px bg-border sm:grid-cols-6">
            {queue.map((q) => (
              <Link
                key={q.status}
                href={`/admin/orders?status=${q.status}`}
                className="flex flex-col items-center bg-card px-2 py-3 text-center hover:bg-muted/40"
              >
                <span className="font-display text-2xl font-semibold tabular-nums">{q.count}</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{q.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Needs attention */}
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">Needs attention</h2>
          </div>
          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">All clear — nothing needs attention.</p>
          ) : (
            <ul>
              {alerts.map((a, i) => {
                const Icon = a.icon;
                return (
                  <li key={i}>
                    <Link href={a.href} className="flex items-start gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/30">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.color}`} />
                      <div>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.detail}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recent orders</h2>
        <Link href="/admin/orders" className="text-sm text-primary hover:underline">
          View all →
        </Link>
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Album</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/admin/orders/${r.id}`} className="font-mono text-primary hover:underline">
                    #{shortId(r.id)}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.customerName ?? emails.get(r.userId) ?? '—'}</td>
                <td className="px-3 py-2">{r.albumTitle ?? '—'}</td>
                <td className="px-3 py-2 text-right">{inr(r.total)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.placedAt as unknown as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
