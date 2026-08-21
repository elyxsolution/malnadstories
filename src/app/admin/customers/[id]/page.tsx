import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { profiles, orders, orderItems, albums, couponRedemptions, coupons, auditLog } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail } from '@/lib/admin/users';
import { inr, shortId, fmtDate, fmtDateTime, statusChip } from '@/lib/admin/format';

const ACTIVITY_LABEL: Record<string, string> = {
  'order.created': 'Order placed',
  'order.paid': 'Payment confirmed',
  'order.status_changed': 'Order status changed',
  'order.tracking_set': 'Tracking added',
  'order.note_added': 'Internal note added',
  'coupon.created': 'Coupon created',
};

export default async function AdminCustomerDetail({ params }: { params: { id: string } }) {
  await requireAdmin();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, params.id)).limit(1);
  if (!profile) notFound();

  const [email, orderRows, albumRows, redemptions, activity] = await Promise.all([
    adminUserEmail(profile.id),
    // HISTORICAL purchase display comes from the order snapshot (0056), not the live album:
    // `orders.album_id` names only the first album of a combined order, and a later rename must
    // never rewrite what a past order says it sold. Aggregated per order in SQL so the table stays
    // one row per order and this stays a single query.
    db
      .select({
        id: orders.id,
        status: orders.status,
        total: orders.totalAmount,
        placedAt: orders.placedAt,
        itemCount: sql<number>`count(${orderItems.id})::int`,
        copies: sql<number>`coalesce(sum(${orderItems.copies}), ${orders.copies})::int`,
        firstTitle: sql<string | null>`min(${orderItems.albumTitle})`,
      })
      .from(orders)
      .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(eq(orders.userId, params.id))
      .groupBy(orders.id, orders.status, orders.totalAmount, orders.placedAt, orders.copies)
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
    // Activity timeline — audit_log rows whose metadata embeds this customer_id.
    db
      .select({
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(sql`${auditLog.metadata}->>'customer_id' = ${params.id}`)
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
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
          <table className="ms-stack w-full text-sm">
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
                  <td data-label="Order" className="px-3 py-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(o.id)}
                    </Link>
                  </td>
                  <td data-label="Album" className="px-3 py-2">
                    {o.itemCount > 1 ? `${o.firstTitle ?? 'Album'} + ${o.itemCount - 1} more` : (o.firstTitle ?? '—')}
                  </td>
                  <td data-label="Amount" className="px-3 py-2 text-right">{inr(o.total)}</td>
                  <td data-label="Copies" className="px-3 py-2 text-center">{o.copies}</td>
                  <td data-label="Status" className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(o.status)}`}>
                      {o.status}
                    </span>
                  </td>
                  <td data-label="Placed" className="px-3 py-2 text-muted-foreground">{fmtDate(o.placedAt as unknown as string)}</td>
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

      <h2 className="mt-6 mb-2 text-sm font-semibold">Activity ({activity.length})</h2>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
      ) : (
        <ul className="space-y-0">
          {activity.map((a, i) => {
            const meta = (a.metadata ?? {}) as Record<string, unknown>;
            const detail =
              a.action === 'order.status_changed' && meta.from && meta.to ? `${meta.from} → ${meta.to}` : a.entityType;
            return (
              <li key={i} className="flex items-start gap-3 border-b py-2.5 last:border-0">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {ACTIVITY_LABEL[a.action] ?? a.action}
                    {a.entityType === 'order' && (
                      <Link href={`/admin/orders/${a.entityId}`} className="ml-1.5 font-mono text-xs text-primary hover:underline">
                        #{shortId(a.entityId)}
                      </Link>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{detail}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(a.createdAt as unknown as string)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
