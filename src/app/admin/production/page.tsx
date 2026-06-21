import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { orders, albums, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminStatusLabel } from '@/lib/orders/status';
import ProductionBoard, { type BoardCard } from './_board';

// The board columns are EXISTING order states only (no binding/QC — those don't exist).
const COLUMNS = ['paid', 'processing', 'printing', 'packed', 'shipped'] as const;

export default async function AdminProductionPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      copies: orders.copies,
      placedAt: orders.placedAt,
      albumTitle: albums.title,
      albumSize: albums.size,
      customerName: profiles.name,
    })
    .from(orders)
    .leftJoin(albums, eq(orders.albumId, albums.id))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .where(inArray(orders.status, COLUMNS as unknown as string[]))
    .orderBy(asc(orders.placedAt));

  const columns = COLUMNS.map((status) => ({
    status,
    label: adminStatusLabel(status),
    cards: rows
      .filter((r) => r.status === status)
      .map(
        (r): BoardCard => ({
          id: r.id,
          albumTitle: r.albumTitle ?? '—',
          customerName: r.customerName ?? '—',
          spec: `${r.albumSize ?? ''}pp · ${r.copies} cop${r.copies === 1 ? 'y' : 'ies'}`,
          placedAt: r.placedAt as unknown as string,
        }),
      ),
  }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Production</h1>
        <span className="text-sm text-muted-foreground">{rows.length} in production</span>
      </div>
      <ProductionBoard columns={columns} />
    </div>
  );
}
