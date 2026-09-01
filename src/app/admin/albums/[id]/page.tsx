import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { albums, profiles, orders } from '@/db/schema';
import { getAdminContext, requireAdmin } from '@/lib/auth/require-admin';
import { roleHasCapability } from '@/lib/auth/capabilities';
import { createServiceClient } from '@/lib/supabase/service';
import { adminUserEmail } from '@/lib/admin/users';
import { loadAlbumForAdmin } from '@/lib/admin/album-view';
import { getAlbumReadiness } from '@/lib/admin/readiness';
import { loadAlbumValidation } from '@/lib/albums/validation';
import { loadRenderReadiness } from '@/lib/albums/render-readiness';
import { checkWorker } from '@/lib/worker/health';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import { Check, AlertTriangle } from 'lucide-react';
import PrintDiagnostics from '@/components/print-diagnostics';
import AdminPdfControls from './_pdf-controls';
import AlbumPreview from './_album-preview';
import { builderFontVars } from '@/lib/fonts';

/**
 * LIVE READS ONLY.
 *
 * This page reports the state of a background job (`album_pdfs`), so a cached read is a wrong
 * read. `requireAdmin()` already makes it dynamic, but the per-fetch Data Cache is separate:
 * supabase-js issues the same PostgREST GET every time, and Next will happily serve the earlier
 * response — which is how a `router.refresh()` after generation finishes could re-render with the
 * very snapshot it was refreshing to escape. Exactly the fix `/albums/[id]/print` already carries,
 * for exactly the same reason.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminAlbumDetail({ params }: { params: { id: string } }) {
  await requireAdmin();
  /**
   * May THIS administrator open the customer's builder on this album?
   *
   * The same `album:manage` capability the PDF controls on this page already require, and the
   * same one `resolveAlbumWriteAccess` enforces on the route itself and on every save. Hiding the
   * button for a role without it is a courtesy, NOT the boundary — a support-role admin who typed
   * the URL is refused server-side and gets the ordinary 404.
   */
  const canEditAlbum = roleHasCapability((await getAdminContext()).role, 'album:manage');

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
  // Render readiness (Section 7) is a SECOND, independent indicator — validation answers "is the
  // album data complete?", render readiness answers "can the renderer produce it right now?" — so
  // the admin can tell a content problem from a pipeline/asset problem.
  const svcClient = createServiceClient();
  const [validation, renderReadiness, pdfRes, reviewRes, worker] = await Promise.all([
    loadAlbumValidation(svcClient, album.id),
    loadRenderReadiness(svcClient, album.id),
    // The PREVIEW artifact (0058) — the print exports report their own state in the Print files
    // control, which polls per kind.
    svcClient.from('album_pdfs').select('status, stage, failure_code, attempts, requested_at, generated_at').eq('album_id', album.id).eq('kind', 'preview').maybeSingle(),
    svcClient.from('album_reviews').select('status').eq('album_id', album.id).maybeSingle(),
    checkWorker(),
  ]);
  const pdf = pdfRes.data as
    | { status: string; stage: string | null; failure_code: string | null; attempts: number | null; requested_at: string | null; generated_at: string | null }
    | null;
  const reviewStatus = (reviewRes.data as { status: string } | null)?.status ?? null;

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

      {/*
        EDIT THE ALBUM ITSELF — the customer's own builder, on this album.

        Deliberately a link to `/albums/[id]/build` and not an admin editor: a second editor would
        be a second thing to keep in step with the renderer, the layout schema and the print export.
        The admin edits the same saved state, and the PDF buttons below then render from exactly
        what was saved — which is why "generate after editing" needs no separate path.
      */}
      {canEditAlbum && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <div className="min-w-[220px] flex-1">
            <p className="text-sm font-semibold">Correct this album yourself</p>
            <p className="text-xs text-muted-foreground">
              Opens the customer&rsquo;s album builder. Your changes are saved to their album, and the PDF is
              generated from that saved state — no need to send it back for a small fix.
            </p>
          </div>
          <Link
            href={`/albums/${album.id}/build`}
            className="shrink-0 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
          >
            Open in builder
          </Link>
        </div>
      )}

      {/* Preview PDF controls + the printer-ready Print files group (0058). Block, not a flex row:
          the print group below the preview buttons is full-width. */}
      <div className="mt-4">
        <AdminPdfControls
          albumId={album.id}
          contentPages={album.size}
          printReady={validation?.printReady ?? true}
          blockingIssues={validation ? [...validation.critical, ...validation.warnings].map((i) => i.title) : []}
        />
      </div>

      {/* THE one debugging screen (Section 9) — all diagnostics from the centralized systems in one
          shared component: validation · render readiness · PDF stage/failure · review · pipeline. */}
      <PrintDiagnostics
        audience="admin"
        className="mt-6"
        validation={validation}
        render={renderReadiness}
        pdf={pdf ? { status: pdf.status, stage: pdf.stage, failureCode: pdf.failure_code } : null}
        review={reviewStatus ? { status: reviewStatus } : null}
        admin={{
          attempts: pdf?.attempts ?? null,
          generatedAt: pdf?.generated_at ?? null,
          requestedAt: pdf?.requested_at ?? null,
          workerReady: worker.ready,
        }}
      />

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
