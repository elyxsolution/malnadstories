import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { albums, profiles, orders } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { shortId, fmtDate, statusChip } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';

export default async function AdminAlbumsPage() {
  await requireAdmin();

  const [rows, orderRows] = await Promise.all([
    db
      .select({
        id: albums.id,
        title: albums.title,
        status: albums.status,
        updatedAt: albums.updatedAt,
        userId: albums.userId,
        customerName: profiles.name,
      })
      .from(albums)
      .leftJoin(profiles, eq(albums.userId, profiles.id))
      .orderBy(desc(albums.updatedAt))
      .limit(200),
    db
      .select({ id: orders.id, albumId: orders.albumId, status: orders.status, placedAt: orders.placedAt })
      .from(orders)
      .orderBy(desc(orders.placedAt)),
  ]);

  // Most recent order per album (orderRows already sorted newest-first).
  const latestOrder = new Map<string, { id: string; status: string }>();
  for (const o of orderRows) {
    if (!latestOrder.has(o.albumId)) latestOrder.set(o.albumId, { id: o.id, status: o.status });
  }
  const emails = await adminUserEmails(rows.map((r) => r.userId));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Albums</h1>
        <span className="text-sm text-muted-foreground">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No albums yet"
          description="Albums appear here as customers create them. There's nothing to show yet."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Album</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Album status</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const ord = latestOrder.get(a.id);
                return (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td data-label="Album" className="px-3 py-2">
                      <Link href={`/admin/albums/${a.id}`} className="text-primary hover:underline">
                        {a.title}
                      </Link>
                    </td>
                    <td data-label="Customer" className="px-3 py-2">
                      <Link href={`/admin/customers/${a.userId}`} className="hover:underline">
                        {a.customerName ?? emails.get(a.userId) ?? '—'}
                      </Link>
                    </td>
                    <td data-label="Album status" className="px-3 py-2 capitalize text-muted-foreground">{a.status}</td>
                    <td data-label="Order" className="px-3 py-2">
                      {ord ? (
                        <Link href={`/admin/orders/${ord.id}`} className="inline-flex items-center gap-2 hover:underline">
                          <span className="font-mono text-primary">#{shortId(ord.id)}</span>
                          <StatusBadge className={statusChip(ord.status)} label={ord.status} />

                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td data-label="Updated" className="px-3 py-2 text-muted-foreground">{fmtDate(a.updatedAt as unknown as string)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
