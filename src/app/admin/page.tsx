import Link from 'next/link';
import { and, count, desc, eq, gte, inArray, isNull, lte, or, sum } from 'drizzle-orm';
import { db } from '@/db';
import { orders, coupons, couponRedemptions, albums, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';

const PAID_FAMILY = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'];
const AWAITING = ['paid', 'processing', 'printing', 'packed'];

export default async function AdminDashboard() {
  await requireAdmin();

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
