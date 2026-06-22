import Link from 'next/link';
import { and, count, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { albumReviews, albums, profiles } from '@/db/schema';
import { adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';
import { REVIEW_STATUSES, reviewStatusLabel, reviewStatusChip, isReviewStatus } from '@/lib/reviews/model';

const PAGE_SIZE = 25;
const SINCE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Pending reviews older than this read as "waiting too long" (gentle priority cue).
const STALE_HOURS = 48;

/**
 * Admin queue for album reviews. Reads cross-customer via Drizzle (postgres superuser);
 * the page that mounts this is already requireAdmin-gated. Pending reviews surface first
 * and oldest-first, so the team works the backlog in order.
 */
export default async function ReviewQueue({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; since?: string; page?: string };
}) {
  const base = '/admin/reviews';
  const q = (searchParams.q ?? '').trim();
  const status = isReviewStatus(searchParams.status ?? '') ? searchParams.status! : '';
  const since = SINCE_DAYS[searchParams.since ?? ''] ? searchParams.since! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const sinceDate = since ? new Date(Date.now() - SINCE_DAYS[since] * 86400000) : null;

  const conds = [];
  if (status) conds.push(eq(albumReviews.status, status));
  if (sinceDate) conds.push(gte(albumReviews.updatedAt, sinceDate));
  if (q)
    conds.push(
      or(
        sql`${albumReviews.id}::text ilike ${`%${q}%`}`,
        sql`${albumReviews.albumId}::text ilike ${`%${q}%`}`,
        ilike(albums.title, `%${q}%`),
        ilike(profiles.name, `%${q}%`),
      )!,
    );
  const where = conds.length ? and(...conds) : sql`true`;

  const [rows, totalRes, statusCounts] = await Promise.all([
    db
      .select({
        id: albumReviews.id,
        albumId: albumReviews.albumId,
        albumTitle: albums.title,
        status: albumReviews.status,
        updatedAt: albumReviews.updatedAt,
        createdAt: albumReviews.createdAt,
        customerId: albumReviews.customerId,
        customerName: profiles.name,
      })
      .from(albumReviews)
      .leftJoin(albums, eq(albumReviews.albumId, albums.id))
      .leftJoin(profiles, eq(albumReviews.customerId, profiles.id))
      .where(where)
      // Pending first, then by least-recently-updated (oldest waiting at the top).
      .orderBy(sql`case when ${albumReviews.status} = 'pending_review' then 0 else 1 end`, albumReviews.updatedAt)
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ c: count() }).from(albumReviews).leftJoin(albums, eq(albumReviews.albumId, albums.id)).leftJoin(profiles, eq(albumReviews.customerId, profiles.id)).where(where),
    db.select({ status: albumReviews.status, c: count() }).from(albumReviews).groupBy(albumReviews.status),
  ]);

  const total = totalRes[0]?.c ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const emails = await adminUserEmails(rows.map((r) => r.customerId));
  const counts: Record<string, number> = {};
  for (const s of statusCounts) counts[s.status] = s.c;
  const pendingCount = counts.pending_review ?? 0;

  const hrefWith = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, status, since, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, String(v));
    const s = sp.toString();
    return `${base}${s ? `?${s}` : ''}`;
  };

  const statusTabs = [{ key: '', label: 'All' }, ...REVIEW_STATUSES.map((s) => ({ key: s, label: reviewStatusLabel(s) }))];
  const sinceTabs = [
    { key: '', label: 'All time' },
    { key: '7d', label: 'Last 7d' },
    { key: '30d', label: 'Last 30d' },
    { key: '90d', label: 'Last 90d' },
  ];
  const staleBefore = Date.now() - STALE_HOURS * 3600000;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Album Reviews</h1>
        <span className="text-sm text-muted-foreground">
          {pendingCount} pending · {total} total
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {statusTabs.map((t) => {
          const active = status === t.key;
          return (
            <Link
              key={t.key || 'all'}
              href={hrefWith({ status: t.key || undefined, page: undefined })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {t.label}
              {t.key && counts[t.key] ? <span className="ml-1 opacity-70">{counts[t.key]}</span> : null}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        {since && <input type="hidden" name="since" value={since} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search album, customer, id…"
          className="h-8 w-[240px] rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
        />
        <button type="submit" className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          Search
        </button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {sinceTabs.map((t) => {
            const active = since === t.key;
            return (
              <Link
                key={t.key || 'all'}
                href={hrefWith({ since: t.key || undefined, page: undefined })}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No matching reviews"
          description="No album reviews match these filters. Clear them to see every review in the queue."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Review</th>
                <th className="px-3 py-2">Album</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const waiting =
                  r.status === 'pending_review' && new Date(r.updatedAt as unknown as string).getTime() < staleBefore;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`${base}/${r.id}`} className="font-mono text-primary hover:underline">
                        #{shortId(r.id)}
                      </Link>
                      {waiting && (
                        <span className="ml-2 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                          waiting
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.albumTitle ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div>{r.customerName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{emails.get(r.customerId) ?? ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge className={reviewStatusChip(r.status)} label={reviewStatusLabel(r.status)} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.updatedAt as unknown as string)}</td>
                  </tr>
                );
              })}
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
              <Link href={hrefWith({ page: page - 1 })} className="rounded-lg border px-3 py-1 hover:bg-muted">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={hrefWith({ page: page + 1 })} className="rounded-lg border px-3 py-1 hover:bg-muted">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
