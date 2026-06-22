import Link from 'next/link';
import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { refundRequests, reprintRequests, profiles } from '@/db/schema';
import { adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';
import {
  REQUEST_STATUSES,
  statusLabel,
  statusChip,
  refundReasonLabel,
  reprintIssueLabel,
  isRequestStatus,
} from '@/lib/resolutions/model';

export type ResolutionKind = 'refund' | 'reprint';

const PAGE_SIZE = 25;
const SINCE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

type Row = {
  id: string;
  detail: string;
  status: string;
  createdAt: unknown;
  customerId: string;
  customerName: string | null;
  orderId: string;
};

/**
 * Shared admin queue for refund + reprint requests. Reads cross-customer via Drizzle
 * (postgres superuser); the page that mounts this is already requireAdmin-gated.
 */
export default async function ResolutionQueue({
  kind,
  searchParams,
}: {
  kind: ResolutionKind;
  searchParams: { q?: string; status?: string; since?: string; page?: string };
}) {
  const base = kind === 'refund' ? '/admin/refunds' : '/admin/reprints';
  const detailLabel = kind === 'refund' ? refundReasonLabel : reprintIssueLabel;

  const q = (searchParams.q ?? '').trim();
  const status = isRequestStatus(searchParams.status ?? '') ? searchParams.status! : '';
  const since = SINCE_DAYS[searchParams.since ?? ''] ? searchParams.since! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const sinceDate = since ? new Date(Date.now() - SINCE_DAYS[since] * 86400000) : null;

  let rows: Row[];
  let total: number;
  let statusCounts: { status: string; c: number }[];

  if (kind === 'refund') {
    const conds = [];
    if (status) conds.push(eq(refundRequests.status, status));
    if (sinceDate) conds.push(gte(refundRequests.createdAt, sinceDate));
    if (q)
      conds.push(
        or(
          sql`${refundRequests.id}::text ilike ${`%${q}%`}`,
          sql`${refundRequests.orderId}::text ilike ${`%${q}%`}`,
          ilike(profiles.name, `%${q}%`),
        )!,
      );
    const where = conds.length ? and(...conds) : sql`true`;
    const [r, t, sc] = await Promise.all([
      db
        .select({
          id: refundRequests.id,
          detail: refundRequests.reason,
          status: refundRequests.status,
          createdAt: refundRequests.createdAt,
          customerId: refundRequests.customerId,
          customerName: profiles.name,
          orderId: refundRequests.orderId,
        })
        .from(refundRequests)
        .leftJoin(profiles, eq(refundRequests.customerId, profiles.id))
        .where(where)
        .orderBy(desc(refundRequests.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset),
      db.select({ c: count() }).from(refundRequests).leftJoin(profiles, eq(refundRequests.customerId, profiles.id)).where(where),
      db.select({ status: refundRequests.status, c: count() }).from(refundRequests).groupBy(refundRequests.status),
    ]);
    rows = r;
    total = t[0]?.c ?? 0;
    statusCounts = sc;
  } else {
    const conds = [];
    if (status) conds.push(eq(reprintRequests.status, status));
    if (sinceDate) conds.push(gte(reprintRequests.createdAt, sinceDate));
    if (q)
      conds.push(
        or(
          sql`${reprintRequests.id}::text ilike ${`%${q}%`}`,
          sql`${reprintRequests.orderId}::text ilike ${`%${q}%`}`,
          ilike(profiles.name, `%${q}%`),
        )!,
      );
    const where = conds.length ? and(...conds) : sql`true`;
    const [r, t, sc] = await Promise.all([
      db
        .select({
          id: reprintRequests.id,
          detail: reprintRequests.issueType,
          status: reprintRequests.status,
          createdAt: reprintRequests.createdAt,
          customerId: reprintRequests.customerId,
          customerName: profiles.name,
          orderId: reprintRequests.orderId,
        })
        .from(reprintRequests)
        .leftJoin(profiles, eq(reprintRequests.customerId, profiles.id))
        .where(where)
        .orderBy(desc(reprintRequests.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset),
      db.select({ c: count() }).from(reprintRequests).leftJoin(profiles, eq(reprintRequests.customerId, profiles.id)).where(where),
      db.select({ status: reprintRequests.status, c: count() }).from(reprintRequests).groupBy(reprintRequests.status),
    ]);
    rows = r;
    total = t[0]?.c ?? 0;
    statusCounts = sc;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const emails = await adminUserEmails(rows.map((r) => r.customerId));
  const counts: Record<string, number> = {};
  for (const s of statusCounts) counts[s.status] = s.c;
  const openCount = (counts.pending ?? 0) + (counts.under_review ?? 0) + (counts.approved ?? 0);

  const hrefWith = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, status, since, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, String(v));
    const s = sp.toString();
    return `${base}${s ? `?${s}` : ''}`;
  };

  const statusTabs = [{ key: '', label: 'All' }, ...REQUEST_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))];
  const sinceTabs = [
    { key: '', label: 'All time' },
    { key: '7d', label: 'Last 7d' },
    { key: '30d', label: 'Last 30d' },
    { key: '90d', label: 'Last 90d' },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{kind === 'refund' ? 'Refunds' : 'Reprints'}</h1>
        <span className="text-sm text-muted-foreground">
          {openCount} active · {total} total
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
          placeholder="Search customer, order, id…"
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
          title="No matching requests"
          description="No requests match these filters. Clear them to see every request in the queue."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">{kind === 'refund' ? 'Reason' : 'Issue'}</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`${base}/${r.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(r.id)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{detailLabel(r.detail)}</td>
                  <td className="px-3 py-2">
                    <div>{r.customerName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{emails.get(r.customerId) ?? ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">
                      #{shortId(r.orderId)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge className={statusChip(r.status)} label={statusLabel(r.status)} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.createdAt as string)}</td>
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
