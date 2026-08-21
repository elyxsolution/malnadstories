import Link from 'next/link';
import { and, desc, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog } from '@/db/schema';
import { requireCapability } from '@/lib/auth/require-admin';
import SecurityFilters from './_filters';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// The security-relevant slice of the append-only audit trail (0016). 'access.denied' is
// emitted by the RBAC layer (require-admin); the 'security.*' family by the Phase 10C
// guard. Read-only — this surface never mutates the trail.
const SECURITY_ACTIONS = [
  'security.rate_limit',
  'security.access_denied',
  'security.violation',
  'access.denied',
] as const;

const ACTION_LABEL: Record<string, string> = {
  'security.rate_limit': 'Rate limit',
  'security.access_denied': 'Access denied',
  'security.violation': 'Violation',
  'access.denied': 'RBAC denied',
};

const RANGES: Record<string, number | null> = { '24h': 1, '7d': 7, '30d': 30, all: null };

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

type Search = { action?: string; range?: string; q?: string; page?: string };

/**
 * Security Center (Phase 10C). Gated security:view (super_admin / production / support).
 * Reads the security slice of audit_log via Drizzle (cross-user admin pattern). Read-only:
 * filter + inspect rate-limit blocks, RBAC denials, and violations. No mutations.
 */
export default async function SecurityPage({ searchParams }: { searchParams: Search }) {
  await requireCapability('security:view');

  const action = searchParams.action && (SECURITY_ACTIONS as readonly string[]).includes(searchParams.action)
    ? searchParams.action
    : undefined;
  const range = searchParams.range && range_(searchParams.range) ? searchParams.range : '7d';
  const q = (searchParams.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(searchParams.page) || 1);

  const conds: (SQL | undefined)[] = [
    inArray(auditLog.action, action ? [action] : (SECURITY_ACTIONS as unknown as string[])),
  ];
  const days = RANGES[range];
  if (days) conds.push(gte(auditLog.createdAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
  if (q) conds.push(or(ilike(auditLog.action, `%${q}%`), ilike(sql`${auditLog.metadata}::text`, `%${q}%`)));
  const where = and(...conds.filter(Boolean) as SQL[]);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorType: auditLog.actorType,
        actorId: auditLog.actorId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (next: Partial<Search>) => {
    const sp = new URLSearchParams();
    const merged = { action, range, q, ...next };
    if (merged.action) sp.set('action', merged.action);
    if (merged.range && merged.range !== '7d') sp.set('range', merged.range);
    if (merged.q) sp.set('q', merged.q);
    if (merged.page && Number(merged.page) > 1) sp.set('page', String(merged.page));
    const qs = sp.toString();
    return qs ? `/admin/security?${qs}` : '/admin/security';
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Security Center</h1>
        <p className="text-sm text-muted-foreground">
          Rate-limit blocks, access denials, and security violations — from the immutable audit trail. Read-only.
        </p>
      </div>

      <SecurityFilters
        actions={SECURITY_ACTIONS as readonly string[]}
        actionLabels={ACTION_LABEL}
        ranges={Object.keys(RANGES)}
        active={{ action, range, q }}
      />

      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            No security events match these filters — nothing to review.
          </p>
        ) : (
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td data-label="Event" className="px-4 py-2.5 align-top">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-foreground">
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  </td>
                  <td data-label="Actor" className="px-4 py-2.5 align-top text-xs text-muted-foreground">
                    {r.actorType}
                    {r.actorId ? ` · ${r.actorId.slice(0, 8)}` : ''}
                  </td>
                  <td data-label="Detail" className="max-w-md px-4 py-2.5 align-top text-xs text-muted-foreground">
                    <code className="line-clamp-2 break-all font-mono text-[11px]">{summarize(r.metadata)}</code>
                  </td>
                  <td data-label="When" className="px-4 py-2.5 align-top text-xs text-muted-foreground">{fmt(r.createdAt)}</td>
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

function range_(v: string): boolean {
  return v in RANGES;
}

/** Compact, readable one-liner from the event metadata jsonb (already sanitized at write). */
function summarize(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '—';
  const m = metadata as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['surface', 'capability', 'path', 'ip', 'retryAfterSec', 'directive', 'emailHash']) {
    if (m[k] !== undefined && m[k] !== null) parts.push(`${k}=${String(m[k])}`);
  }
  return parts.length ? parts.join('  ') : JSON.stringify(m).slice(0, 200);
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
