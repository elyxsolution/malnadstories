import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { orders, albums, profiles, addresses, shipments } from '@/db/schema';
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
      albumTitle: albums.title,
      customerName: profiles.name,
      city: addresses.city,
      state: addresses.state,
      shipmentStatus: shipments.shipmentStatus,
    })
    .from(orders)
    .leftJoin(albums, eq(orders.albumId, albums.id))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .leftJoin(addresses, eq(orders.addressId, addresses.id))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(inArray(orders.status, DISPATCH_STATES))
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
          <table className="w-full text-sm">
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
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${r.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(r.id)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.albumTitle ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.customerName ?? '—'}
                      {r.city ? ` · ${r.city}, ${r.state}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.carrier ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-amber-700">{r.trackingNumber ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusBadge className={statusChip(r.status)} label={adminStatusLabel(r.status)} />
                  </td>
                  <td className="px-3 py-2">
                    {r.shipmentStatus ? (
                      <StatusBadge className={shipmentStatusChip(r.shipmentStatus)} label={shipmentStatusLabel(r.shipmentStatus)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.shippedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
