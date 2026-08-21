import Link from 'next/link';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, orderItems, profiles, addresses, shipments } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { shortId, fmtDate, statusChip } from '@/lib/admin/format';
import { adminStatusLabel } from '@/lib/orders/status';
import { shipmentStatusLabel, shipmentStatusChip } from '@/lib/shipping/model';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';

const DISPATCH_STATES = ['packed', 'shipped', 'delivered'];

/**
 * Shipping dispatch (read-only). Lists orders in the dispatch states with their
 * existing tracking fields. Tracking is set on the order detail via the audited
 * admin_set_tracking RPC — this view never writes. No courier API.
 */
export default async function AdminShippingPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      carrier: orders.carrier,
      trackingNumber: orders.trackingNumber,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      placedAt: orders.placedAt,
      // What is in the parcel, from the purchase snapshot (0056) — `orders.album_id` names only
      // the first album, so a combined shipment would otherwise be labelled with one book.
      // Aggregated in SQL to keep this one query and one row per order.
      itemCount: sql<number>`count(${orderItems.id})::int`,
      firstTitle: sql<string | null>`min(${orderItems.albumTitle})`,
      totalCopies: sql<number>`coalesce(sum(${orderItems.copies}), ${orders.copies})::int`,
      customerName: profiles.name,
      city: addresses.city,
      state: addresses.state,
      shipmentStatus: shipments.shipmentStatus,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .leftJoin(addresses, eq(orders.addressId, addresses.id))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(inArray(orders.status, DISPATCH_STATES))
    .groupBy(
      orders.id,
      orders.status,
      orders.carrier,
      orders.trackingNumber,
      orders.shippedAt,
      orders.deliveredAt,
      orders.placedAt,
      orders.copies,
      profiles.name,
      addresses.city,
      addresses.state,
      shipments.shipmentStatus,
    )
    .orderBy(desc(orders.placedAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Shipping</h1>
        <span className="text-sm text-muted-foreground">{rows.length} in dispatch</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in dispatch"
          description="Orders appear here once they reach packed, shipped, or delivered. Advance an order from its detail page to begin dispatch."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Album / To</th>
                <th className="px-3 py-2">Courier</th>
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Order status</th>
                <th className="px-3 py-2">Shipment</th>
                <th className="px-3 py-2">Shipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td data-label="Order" className="px-3 py-2">
                    <Link href={`/admin/orders/${r.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(r.id)}
                    </Link>
                  </td>
                  <td data-label="Album / To" data-block className="px-3 py-2">
                    <div>
                      {r.itemCount > 1
                        ? `${r.firstTitle ?? 'Album'} + ${r.itemCount - 1} more · ${r.totalCopies} copies`
                        : (r.firstTitle ?? '—')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.customerName ?? '—'}
                      {r.city ? ` · ${r.city}, ${r.state}` : ''}
                    </div>
                  </td>
                  <td data-label="Courier" className="px-3 py-2">{r.carrier ?? '—'}</td>
                  <td data-label="Tracking" className="px-3 py-2 font-mono text-xs text-amber-700">{r.trackingNumber ?? '—'}</td>
                  <td data-label="Order status" className="px-3 py-2">
                    <StatusBadge className={statusChip(r.status)} label={adminStatusLabel(r.status)} />
                  </td>
                  <td data-label="Shipment" className="px-3 py-2">
                    {r.shipmentStatus ? (
                      <StatusBadge className={shipmentStatusChip(r.shipmentStatus)} label={shipmentStatusLabel(r.shipmentStatus)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td data-label="Shipped" className="px-3 py-2 text-muted-foreground">{fmtDate(r.shippedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
