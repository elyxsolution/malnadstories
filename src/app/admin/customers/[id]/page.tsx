import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { profiles, orders, albums, couponRedemptions, coupons } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail } from '@/lib/admin/users';
import { inr, shortId, fmtDate, fmtDateTime, statusChip } from '@/lib/admin/format';

export default async function AdminCustomerDetail({ params }: { params: { id: string } }) {
  await requireAdmin();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, params.id)).limit(1);
  if (!profile) notFound();

  const [email, orderRows, albumRows, redemptions] = await Promise.all([
    adminUserEmail(profile.id),
    db
      .select({
        id: orders.id,
        status: orders.status,
        total: orders.totalAmount,
        copies: orders.copies,
        placedAt: orders.placedAt,
        albumTitle: albums.title,
      })
      .from(orders)
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .where(eq(orders.userId, params.id))
      .orderBy(desc(orders.placedAt)),
    db
      .select({ id: albums.id, title: albums.title, status: albums.status, updatedAt: albums.updatedAt })
      .from(albums)
      .where(eq(albums.userId, params.id))
      .orderBy(desc(albums.updatedAt)),
    db
      .select({
        couponId: couponRedemptions.couponId,
        code: coupons.code,
        amountDiscounted: couponRedemptions.amountDiscounted,
        orderId: couponRedemptions.orderId,
        redeemedAt: couponRedemptions.redeemedAt,
      })
      .from(couponRedemptions)
      .leftJoin(coupons, eq(couponRedemptions.couponId, coupons.id))
      .where(eq(couponRedemptions.userId, params.id))
      .orderBy(desc(couponRedemptions.redeemedAt)),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/customers" className="hover:underline">
          Customers
        </Link>
        {' / '}
        {profile.name ?? email}
      </p>
      <h1 className="mt-1 text-xl font-bold">{profile.name ?? '—'}</h1>
      <p className="text-sm text-muted-foreground">{email}{profile.phone ? ` · ${profile.phone}` : ''}</p>
      <p className="text-xs text-muted-foreground">Joined {fmtDate(profile.createdAt as unknown as string)}</p>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Order history ({orderRows.length})</h2>
      {orderRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Album</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-center">Copies</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Placed</th>
              </tr>
            </thead>
            <tbody>
              {orderRows.map((o) => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(o.id)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{o.albumTitle ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{inr(o.total)}</td>
                  <td className="px-3 py-2 text-center">{o.copies}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(o.status)}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(o.placedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Albums ({albumRows.length})</h2>
      {albumRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No albums.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {albumRows.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
              <Link href={`/admin/albums/${a.id}`} className="text-primary hover:underline">
                {a.title}
              </Link>
              <span className="text-xs capitalize text-muted-foreground">{a.status}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Coupon history ({redemptions.length})</h2>
      {redemptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No coupons used.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {redemptions.map((r) => (
            <li key={r.orderId} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Link href={`/admin/coupons/${r.couponId}`} className="font-mono text-primary hover:underline">
                {r.code ?? '—'}
              </Link>
              <span className="text-muted-foreground">
                − {inr(r.amountDiscounted)} on{' '}
                <Link href={`/admin/orders/${r.orderId}`} className="hover:underline">
                  #{shortId(r.orderId)}
                </Link>{' '}
                · {fmtDateTime(r.redeemedAt as unknown as string)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
