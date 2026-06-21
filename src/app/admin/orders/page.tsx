import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, albums, profiles, coupons } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import OrdersFilters from './_filters';
import OrdersTable, { type OrderRow } from './_orders-table';

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

  // Global per-status counts for the filter tabs (independent of the current filter).
  const statusRows = await db.select({ status: orders.status, c: count() }).from(orders).groupBy(orders.status);
  const counts: Record<string, number> = {};
  for (const s of statusRows) counts[s.status] = s.c;

  // Serializable rows for the client table (multi-select / bulk advance / CSV export).
  const tableRows: OrderRow[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    total: String(r.total),
    copies: r.copies,
    placedAt: new Date(r.placedAt as unknown as string).toISOString(),
    customerName: r.customerName,
    email: emails.get(r.userId) ?? '',
    albumTitle: r.albumTitle,
    couponCode: r.couponCode,
  }));

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
        <OrdersFilters q={q} status={status} counts={counts} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No orders match these filters.
        </div>
      ) : (
        <OrdersTable rows={tableRows} />
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
