import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, albums, profiles, coupons } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import OrdersFilters from './_filters';

const PAGE_SIZE = 25;
const VALID_STATUS = new Set([
  'pending', 'paid', 'processing', 'printing', 'packed', 'shipped', 'delivered', 'cancelled', 'failed',
]);

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string };
}) {
  await requireAdmin();

  const q = (searchParams.q ?? '').trim();
  const status = VALID_STATUS.has(searchParams.status ?? '') ? searchParams.status! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conds = [];
  if (status) conds.push(eq(orders.status, status));
  if (q) {
    conds.push(
      or(
        sql`${orders.id}::text ilike ${`%${q}%`}`,
        ilike(albums.title, `%${q}%`),
        ilike(profiles.name, `%${q}%`),
      )!,
    );
  }
  const where = conds.length ? and(...conds) : sql`true`;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: orders.id,
        status: orders.status,
        total: orders.totalAmount,
        copies: orders.copies,
        placedAt: orders.placedAt,
        userId: orders.userId,
        customerName: profiles.name,
        albumTitle: albums.title,
        couponCode: coupons.code,
      })
      .from(orders)
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .leftJoin(profiles, eq(orders.userId, profiles.id))
      .leftJoin(coupons, eq(orders.couponId, coupons.id))
      .where(where)
      .orderBy(desc(orders.placedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ c: count() })
      .from(orders)
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .leftJoin(profiles, eq(orders.userId, profiles.id))
      .where(where),
  ]);

  const total = totalRows[0]?.c ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const emails = await adminUserEmails(rows.map((r) => r.userId));

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (status) sp.set('status', status);
    if (p > 1) sp.set('page', String(p));
    const s = sp.toString();
    return `/admin/orders${s ? `?${s}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Orders</h1>
        <span className="text-sm text-muted-foreground">{total} total</span>
      </div>

      <div className="mb-4">
        <OrdersFilters q={q} status={status} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No orders match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Album</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-center">Copies</th>
                <th className="px-3 py-2">Coupon</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
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
                    <div>{r.customerName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{emails.get(r.userId) ?? ''}</div>
                  </td>
                  <td className="px-3 py-2">{r.albumTitle ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{inr(r.total)}</td>
                  <td className="px-3 py-2 text-center">{r.copies}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.couponCode ?? '—'}</td>
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
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="rounded-lg border px-3 py-1 hover:bg-muted">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="rounded-lg border px-3 py-1 hover:bg-muted">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
