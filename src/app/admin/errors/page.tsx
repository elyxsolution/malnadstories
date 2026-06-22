import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { errorEvents } from '@/db/schema';
import { requireCapability } from '@/lib/auth/require-admin';
import {
  SEVERITIES,
  CATEGORIES,
  severityChip,
  severityLabel,
  categoryLabel,
  isSeverity,
  isCategory,
} from '@/lib/observability/model';
import ErrorFilters from './_filters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

type Search = {
  severity?: string;
  category?: string;
  resolved?: string; // 'open' (default) | 'resolved' | 'all'
  q?: string;
  page?: string;
};

/**
 * Error Center (Phase 10B). Gated observability:view (super_admin / production / support). Reads
 * via Drizzle (cross-user admin pattern). Read-only: filter + drill into captured errors; payloads
 * are never editable. Deduped rows show occurrence counts + last-seen.
 */
export default async function ErrorsPage({ searchParams }: { searchParams: Search }) {
  await requireCapability('observability:view');

  const severity = searchParams.severity && isSeverity(searchParams.severity) ? searchParams.severity : undefined;
  const category = searchParams.category && isCategory(searchParams.category) ? searchParams.category : undefined;
  const resolvedMode = searchParams.resolved === 'resolved' ? 'resolved' : searchParams.resolved === 'all' ? 'all' : 'open';
  const q = (searchParams.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(searchParams.page) || 1);

  const conds: (SQL | undefined)[] = [];
  if (severity) conds.push(eq(errorEvents.severity, severity));
  if (category) conds.push(eq(errorEvents.category, category));
  if (resolvedMode === 'open') conds.push(eq(errorEvents.resolved, false));
  if (resolvedMode === 'resolved') conds.push(eq(errorEvents.resolved, true));
  if (q) conds.push(or(ilike(errorEvents.message, `%${q}%`), ilike(errorEvents.source, `%${q}%`)));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: errorEvents.id,
        severity: errorEvents.severity,
        category: errorEvents.category,
        source: errorEvents.source,
        message: errorEvents.message,
        requestId: errorEvents.requestId,
        occurrences: errorEvents.occurrences,
        resolved: errorEvents.resolved,
        lastSeenAt: errorEvents.lastSeenAt,
      })
      .from(errorEvents)
      .where(where)
      .orderBy(desc(errorEvents.lastSeenAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(errorEvents).where(where),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (next: Partial<Search>) => {
    const sp = new URLSearchParams();
    const merged = { severity, category, resolved: resolvedMode, q, ...next };
    if (merged.severity) sp.set('severity', merged.severity);
    if (merged.category) sp.set('category', merged.category);
    if (merged.resolved && merged.resolved !== 'open') sp.set('resolved', merged.resolved);
    if (merged.q) sp.set('q', merged.q);
    if (merged.page && Number(merged.page) > 1) sp.set('page', String(merged.page));
    const qs = sp.toString();
    return qs ? `/admin/errors?${qs}` : '/admin/errors';
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Error Center</h1>
        <p className="text-sm text-muted-foreground">
          Captured failures, exceptions, and slow operations across the app + worker. Read-only.
        </p>
      </div>

      <ErrorFilters
        severities={SEVERITIES as readonly string[]}
        categories={CATEGORIES as readonly string[]}
        active={{ severity, category, resolved: resolvedMode, q }}
      />

      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            No errors match these filters — nothing to investigate.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Message</th>
                <th className="px-4 py-2.5 text-right font-medium tabular-nums">Count</th>
                <th className="px-4 py-2.5 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="group hover:bg-muted/30">
                  <td className="px-4 py-2.5 align-top">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${severityChip(r.severity)}`}>
                      {severityLabel(r.severity)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top text-xs text-muted-foreground">{categoryLabel(r.category)}</td>
                  <td className="max-w-md px-4 py-2.5 align-top">
                    <Link href={`/admin/errors/${r.id}`} className="block">
                      <span className="line-clamp-2 font-medium text-foreground group-hover:underline">{r.message}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {r.source}
                        {r.requestId ? ` · req ${r.requestId.slice(0, 8)}` : ''}
                        {r.resolved ? ' · resolved' : ''}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-right align-top tabular-nums">{r.occurrences}</td>
                  <td className="px-4 py-2.5 align-top text-xs text-muted-foreground">{fmt(r.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {pageCount} · {total} total
          </span>
          <div className="flex gap-2">
            <PagerLink disabled={page <= 1} href={buildHref({ page: String(page - 1) })}>
              Previous
            </PagerLink>
            <PagerLink disabled={page >= pageCount} href={buildHref({ page: String(page + 1) })}>
              Next
            </PagerLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PagerLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled)
    return <span className="cursor-not-allowed rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>;
  return (
    <Link href={href} className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted">
      {children}
    </Link>
  );
}
