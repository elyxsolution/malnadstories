import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { ArrowLeft } from 'lucide-react';
import { db } from '@/db';
import { errorEvents } from '@/db/schema';
import { requireCapability } from '@/lib/auth/require-admin';
import { roleHasCapability } from '@/lib/auth/capabilities';
import { severityChip, severityLabel, categoryLabel } from '@/lib/observability/model';
import ResolveButton from './_resolve';

export const dynamic = 'force-dynamic';

const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString('en-IN') : '—');

/**
 * Error detail (Phase 10B). Read-only — full sanitized payload (message/stack/metadata) +
 * correlation + occurrence window. Resolve is the ONLY mutation, gated observability:manage.
 * Payloads are never editable.
 */
export default async function ErrorDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCapability('observability:view');
  const canManage = roleHasCapability(ctx.role, 'observability:manage');

  const [row] = await db.select().from(errorEvents).where(eq(errorEvents.id, params.id)).limit(1);
  if (!row) notFound();

  const metaJson = row.metadata ? JSON.stringify(row.metadata, null, 2) : null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/admin/errors" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Error Center
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${severityChip(row.severity)}`}>
              {severityLabel(row.severity)}
            </span>
            <span className="text-xs text-muted-foreground">
              {categoryLabel(row.category)} · {row.source}
            </span>
            {row.resolved && <span className="text-xs text-success">✓ resolved</span>}
          </div>
          <h1 className="mt-2 break-words text-lg font-semibold">{row.message}</h1>
        </div>
        {canManage && !row.resolved && <ResolveButton id={row.id} />}
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
        <Field label="Occurrences" value={String(row.occurrences)} />
        <Field label="First seen" value={fmt(row.firstSeenAt)} />
        <Field label="Last seen" value={fmt(row.lastSeenAt)} />
        <Field label="Request id" value={row.requestId ?? '—'} mono />
        <Field label="User id" value={row.userId ?? '—'} mono />
        <Field label="Fingerprint" value={row.fingerprint} mono />
        {row.resolved && <Field label="Resolved at" value={fmt(row.resolvedAt)} />}
        {row.resolved && <Field label="Resolved by" value={row.resolvedBy ?? '—'} mono />}
      </dl>

      {row.stack && (
        <section className="mt-4">
          <h2 className="mb-1.5 text-sm font-semibold">Stack</h2>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">{row.stack}</pre>
        </section>
      )}

      {metaJson && (
        <section className="mt-4">
          <h2 className="mb-1.5 text-sm font-semibold">Metadata</h2>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">{metaJson}</pre>
        </section>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
