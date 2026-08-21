import Link from 'next/link';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { profiles, orders, albums, couponRedemptions } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { fmtDate } from '@/lib/admin/format';

export default async function AdminCustomersPage() {
  await requireAdmin();

  const [custs, orderCounts, albumCounts, couponCounts] = await Promise.all([
    db
      .select({ id: profiles.id, name: profiles.name, phone: profiles.phone, createdAt: profiles.createdAt })
      .from(profiles)
      .where(eq(profiles.role, 'user'))
      .orderBy(desc(profiles.createdAt))
      .limit(200),
    db.select({ userId: orders.userId, c: count() }).from(orders).groupBy(orders.userId),
    db.select({ userId: albums.userId, c: count() }).from(albums).groupBy(albums.userId),
    db.select({ userId: couponRedemptions.userId, c: count() }).from(couponRedemptions).groupBy(couponRedemptions.userId),
  ]);

  const orderMap = new Map(orderCounts.map((r) => [r.userId, r.c]));
  const albumMap = new Map(albumCounts.map((r) => [r.userId, r.c]));
  const couponMap = new Map(couponCounts.map((r) => [r.userId, r.c]));
  const emails = await adminUserEmails(custs.map((c) => c.id));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Customers</h1>
        <span className="text-sm text-muted-foreground">{custs.length} shown</span>
      </div>

      {custs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No customers yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2 text-center">Orders</th>
                <th className="px-3 py-2 text-center">Albums</th>
                <th className="px-3 py-2 text-center">Coupons used</th>
                <th className="px-3 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {custs.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td data-label="Name" className="px-3 py-2">
                    <Link href={`/admin/customers/${c.id}`} className="text-primary hover:underline">
                      {c.name ?? '—'}
                    </Link>
                  </td>
                  <td data-label="Email" className="px-3 py-2 text-muted-foreground">{emails.get(c.id) ?? ''}</td>
                  <td data-label="Orders" className="px-3 py-2 text-center">{orderMap.get(c.id) ?? 0}</td>
                  <td data-label="Albums" className="px-3 py-2 text-center">{albumMap.get(c.id) ?? 0}</td>
                  <td data-label="Coupons used" className="px-3 py-2 text-center">{couponMap.get(c.id) ?? 0}</td>
                  <td data-label="Joined" className="px-3 py-2 text-muted-foreground">{fmtDate(c.createdAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
