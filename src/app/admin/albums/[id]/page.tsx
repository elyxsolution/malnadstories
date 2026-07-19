import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { albums, profiles, orders } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { adminUserEmail } from '@/lib/admin/users';
import { loadAlbumForAdmin } from '@/lib/admin/album-view';
import { getAlbumReadiness } from '@/lib/admin/readiness';
import { loadAlbumValidation } from '@/lib/albums/validation';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import { Check, AlertTriangle } from 'lucide-react';
import AdminPdfControls from './_pdf-controls';
import AlbumPreview from './_album-preview';
import { builderFontVars } from '@/lib/fonts';

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

  const [email, relatedOrders, view, readiness] = await Promise.all([
    adminUserEmail(album.userId),
    db
      .select({ id: orders.id, status: orders.status, total: orders.totalAmount, placedAt: orders.placedAt })
      .from(orders)
      .where(eq(orders.albumId, album.id))
      .orderBy(desc(orders.placedAt)),
    loadAlbumForAdmin(album.id),
    getAlbumReadiness(album.id),
  ]);

  // Central validation report (CHANGE 13) — the SAME report the builder/PDF/checkout use, so the
  // admin sees blocking issues, warnings, completion and print-readiness at a glance.
  const validation = await loadAlbumValidation(createServiceClient(), album.id);
  const submitted = album.status !== 'draft';

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
        <AdminPdfControls
          albumId={album.id}
          printReady={validation?.printReady ?? true}
          blockingIssues={validation ? [...validation.critical, ...validation.warnings].map((i) => i.title) : []}
        />
      </div>

      {/* Validation summary — reuses the centralized Album Validation report (CHANGE 13). */}
      {validation && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`font-display text-2xl font-semibold tabular-nums ${
                validation.statistics.score >= 100 ? 'text-green-600' : validation.statistics.score >= 50 ? 'text-amber-600' : 'text-destructive'
              }`}
            >
              {validation.statistics.score}%
            </span>
            <span className="text-xs text-muted-foreground">ready</span>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${validation.printReady ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}
          >
            {validation.printReady ? 'Print ready' : 'Not print-ready'}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${submitted ? 'bg-studio/10 text-studio' : 'bg-muted text-muted-foreground'}`}>
            {submitted ? 'Customer submitted' : 'Draft'}
          </span>
          <span className="text-xs text-muted-foreground">
            {validation.critical.length} blocking · {validation.warnings.length} warning{validation.warnings.length === 1 ? '' : 's'} · {validation.info.length} note
            {validation.info.length === 1 ? '' : 's'} · {validation.statistics.placedPhotos}/{validation.statistics.expectedPhotos} photos
          </span>
        </div>
      )}

      {/* Print readiness (advisory; read-only — same checks as customer checkout) */}
      {readiness && (
        <div className="mt-6 overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Print readiness</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm tabular-nums text-muted-foreground">
                <span
                  className={`font-bold ${readiness.score >= 90 ? 'text-green-600' : readiness.score >= 70 ? 'text-amber-600' : 'text-destructive'}`}
                >
                  {readiness.score}
                </span>{' '}
                / 100
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${readiness.warnings === 0 ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}
              >
                {readiness.warnings === 0 ? 'Print ready' : `${readiness.warnings} to review`}
              </span>
            </div>
          </div>
          <ul>
            {readiness.items.map((it, i) => (
              <li key={i} className="flex items-start gap-3 border-b px-4 py-2.5 last:border-0">
                <span className={`mt-0.5 ${it.ok ? 'text-green-600' : 'text-amber-600'}`}>
                  {it.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-medium">{it.title}</p>
                  <p className="text-xs text-muted-foreground">{it.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <div className={`${builderFontVars} rounded-lg border bg-card p-4`}>
          <AlbumPreview photos={view.photos} blocks={view.blocks} cover={view.cover} stickerUrls={view.stickerUrls} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This album has no layout to preview yet.</p>
      )}
    </div>
  );
}
