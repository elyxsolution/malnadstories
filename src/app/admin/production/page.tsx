import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { orders, orderItems, albums, albumPdfs, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminStatusLabel } from '@/lib/orders/status';
import ProductionBoard, { type BoardCard } from './_board';

// The board columns are EXISTING order states only (no binding/QC — those don't exist).
const COLUMNS = ['paid', 'processing', 'printing', 'packed', 'shipped'] as const;

/**
 * PRODUCTION BOARD — driven by `order_items`, not by `orders.album_id` (Phase 9).
 *
 * An order is ONE parcel with ONE fulfilment lifecycle, so the card and the "Move to …" action
 * stay order-level — that part was always right. What was wrong is what the card *printed*: it
 * read `orders.album_id`, `orders.copies` and the LIVE `albums.title`, so a combined order showed
 * a single album at the first item's copy count. An operator working from that board would have
 * printed one book of a two-book order, in the wrong quantity.
 *
 * Every purchase unit now comes from `order_items`: its own album, its own `copies`, and its own
 * `album_title` SNAPSHOT — the title as purchased, which a later rename cannot rewrite. Live album
 * data is joined only for operational facts (page count, and the per-album PDF status an operator
 * needs to see), never as the historical identity.
 */
export default async function AdminProductionPage() {
  await requireAdmin();

  const rows = await db
    .select({
      orderId: orders.id,
      status: orders.status,
      placedAt: orders.placedAt,
      customerName: profiles.name,
      // — purchase unit (SNAPSHOT: what was actually bought) —
      itemId: orderItems.id,
      albumId: orderItems.albumId,
      albumTitle: orderItems.albumTitle,
      productName: orderItems.productName,
      copies: orderItems.copies,
      // — operational only (live) —
      albumSize: albums.size,
      pdfStatus: albumPdfs.status,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .leftJoin(albums, eq(orderItems.albumId, albums.id))
    .leftJoin(albumPdfs, eq(orderItems.albumId, albumPdfs.albumId))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .where(inArray(orders.status, COLUMNS as unknown as string[]))
    .orderBy(asc(orders.placedAt), asc(orderItems.createdAt));

  // Group the flat join back into one card per order, each holding its purchase units in
  // purchase order (the same order `orders.album_id`'s first-item pointer refers to).
  const byOrder = new Map<string, BoardCard & { status: string }>();
  for (const r of rows) {
    let card = byOrder.get(r.orderId);
    if (!card) {
      card = {
        id: r.orderId,
        status: r.status,
        customerName: r.customerName ?? '—',
        placedAt: r.placedAt as unknown as string,
        items: [],
        totalCopies: 0,
      };
      byOrder.set(r.orderId, card);
    }
    card.items.push({
      id: r.itemId,
      albumId: r.albumId,
      albumTitle: r.albumTitle,
      spec: `${r.albumSize ?? '—'}pp${r.productName ? ` · ${r.productName}` : ''}`,
      copies: r.copies,
      pdfStatus: r.pdfStatus ?? 'idle',
    });
    card.totalCopies += r.copies;
  }
  const cards = Array.from(byOrder.values());

  const columns = COLUMNS.map((status) => ({
    status,
    label: adminStatusLabel(status),
    cards: cards.filter((c) => c.status === status),
  }));

  const totalUnits = cards.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Production</h1>
        <span className="text-sm text-muted-foreground">
          {cards.length} order{cards.length === 1 ? '' : 's'} · {totalUnits} album{totalUnits === 1 ? '' : 's'} to print
        </span>
      </div>
      <ProductionBoard columns={columns} />
    </div>
  );
}
