import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { albums, profiles, orders } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail } from '@/lib/admin/users';
import { loadAlbumForAdmin } from '@/lib/admin/album-view';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import AdminPdfControls from './_pdf-controls';
import AlbumPreview from './_album-preview';

export default async function AdminAlbumDetail({ params }: { params: { id: string } }) {
  await requireAdmin();

  const [album] = await db
    .select({
      id: albums.id,
      title: albums.title,
      status: albums.status,
      size: albums.size,
      userId: albums.userId,
      customerName: profiles.name,
      updatedAt: albums.updatedAt,
    })
    .from(albums)
    .leftJoin(profiles, eq(albums.userId, profiles.id))
    .where(eq(albums.id, params.id))
    .limit(1);
  if (!album) notFound();

  const [email, relatedOrders, view] = await Promise.all([
    adminUserEmail(album.userId),
    db
      .select({ id: orders.id, status: orders.status, total: orders.totalAmount, placedAt: orders.placedAt })
      .from(orders)
      .where(eq(orders.albumId, album.id))
      .orderBy(desc(orders.placedAt)),
    loadAlbumForAdmin(album.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/albums" className="hover:underline">
          Albums
        </Link>
        {' / '}
        {album.title}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{album.title}</h1>
        <span className="text-xs capitalize text-muted-foreground">{album.status} · {album.size} pages</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Customer:{' '}
        <Link href={`/admin/customers/${album.userId}`} className="text-primary hover:underline">
          {album.customerName ?? email}
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <AdminPdfControls albumId={album.id} />
      </div>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Related orders</h2>
      {relatedOrders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders for this album.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {relatedOrders.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">
                #{shortId(o.id)}
              </Link>
              <span className="flex items-center gap-3">
                <span>{inr(o.total)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(o.status)}`}>
                  {o.status}
                </span>
                <span className="text-muted-foreground">{fmtDate(o.placedAt as unknown as string)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Album preview</h2>
      {view && view.blocks.length > 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <AlbumPreview photos={view.photos} blocks={view.blocks} cover={view.cover} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This album has no layout to preview yet.</p>
      )}
    </div>
  );
}
