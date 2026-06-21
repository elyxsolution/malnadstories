import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { refundRequests, reprintRequests, profiles, orders, albums, auditLog } from '@/db/schema';
import { adminUserEmail, adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId, statusChip as orderStatusChip } from '@/lib/admin/format';
import { statusLabel, statusChip, refundReasonLabel, reprintIssueLabel } from '@/lib/resolutions/model';
import RequestActions from './_actions';
import type { ResolutionKind } from './queue';

const AUDIT_LABEL: Record<string, string> = {
  'refund.request_created': 'Request created',
  'refund.status_changed': 'Status changed',
  'refund.note_added': 'Admin note added',
  'reprint.request_created': 'Request created',
  'reprint.status_changed': 'Status changed',
  'reprint.note_added': 'Admin note added',
};

type Loaded = {
  id: string;
  detail: string;
  description: string;
  status: string;
  adminNotes: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  resolvedAt: unknown;
  resolvedBy: string | null;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  orderId: string;
  orderStatus: string | null;
  albumTitle: string | null;
  supportTicketId: string | null;
};

export default async function ResolutionDetail({ kind, id }: { kind: ResolutionKind; id: string }) {
  const base = kind === 'refund' ? '/admin/refunds' : '/admin/reprints';
  const entityType = kind === 'refund' ? 'refund_request' : 'reprint_request';
  const detailHeading = kind === 'refund' ? 'Reason' : 'Issue';
  const detailLabel = kind === 'refund' ? refundReasonLabel : reprintIssueLabel;

  let loaded: Loaded | undefined;
  if (kind === 'refund') {
    const [row] = await db
      .select({
        id: refundRequests.id,
        detail: refundRequests.reason,
        description: refundRequests.description,
        status: refundRequests.status,
        adminNotes: refundRequests.adminNotes,
        createdAt: refundRequests.createdAt,
        updatedAt: refundRequests.updatedAt,
        resolvedAt: refundRequests.resolvedAt,
        resolvedBy: refundRequests.resolvedBy,
        customerId: refundRequests.customerId,
        customerName: profiles.name,
        customerPhone: profiles.phone,
        orderId: refundRequests.orderId,
        orderStatus: orders.status,
        albumTitle: albums.title,
        supportTicketId: refundRequests.supportTicketId,
      })
      .from(refundRequests)
      .leftJoin(profiles, eq(refundRequests.customerId, profiles.id))
      .leftJoin(orders, eq(refundRequests.orderId, orders.id))
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .where(eq(refundRequests.id, id))
      .limit(1);
    loaded = row;
  } else {
    const [row] = await db
      .select({
        id: reprintRequests.id,
        detail: reprintRequests.issueType,
        description: reprintRequests.description,
        status: reprintRequests.status,
        adminNotes: reprintRequests.adminNotes,
        createdAt: reprintRequests.createdAt,
        updatedAt: reprintRequests.updatedAt,
        resolvedAt: reprintRequests.resolvedAt,
        resolvedBy: reprintRequests.resolvedBy,
        customerId: reprintRequests.customerId,
        customerName: profiles.name,
        customerPhone: profiles.phone,
        orderId: reprintRequests.orderId,
        orderStatus: orders.status,
        albumTitle: albums.title,
        supportTicketId: reprintRequests.supportTicketId,
      })
      .from(reprintRequests)
      .leftJoin(profiles, eq(reprintRequests.customerId, profiles.id))
      .leftJoin(orders, eq(reprintRequests.orderId, orders.id))
      .leftJoin(albums, eq(orders.albumId, albums.id))
      .where(eq(reprintRequests.id, id))
      .limit(1);
    loaded = row;
  }

  if (!loaded) notFound();
  const r = loaded;

  const [email, audits] = await Promise.all([
    adminUserEmail(r.customerId),
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorId: auditLog.actorId,
        actorType: auditLog.actorType,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(sql`${auditLog.entityType} = ${entityType} and ${auditLog.entityId} = ${r.id}`)
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
  ]);

  const actorEmails = await adminUserEmails(
    [...audits.map((a) => a.actorId).filter(Boolean), r.resolvedBy].filter(Boolean) as string[],
  );

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href={base} className="hover:underline">
          {kind === 'refund' ? 'Refunds' : 'Reprints'}
        </Link>
        {' / '}#{shortId(r.id)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          {kind === 'refund' ? 'Refund' : 'Reprint'} — {detailLabel(r.detail)}
        </h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.status)}`}>
          {statusLabel(r.status)}
        </span>
        <span className="text-sm text-muted-foreground">Filed {fmtDateTime(r.createdAt as string)}</span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer">
            <Row label="Name" value={r.customerName ?? '—'} />
            <Row label="Email" value={email || '—'} />
            <Row label="Phone" value={r.customerPhone ?? '—'} />
            <Row
              label="Customer record"
              value={
                <Link href={`/admin/customers/${r.customerId}`} className="text-primary hover:underline">
                  View customer
                </Link>
              }
            />
          </Section>

          <Section title="Request">
            <Row label={detailHeading} value={detailLabel(r.detail)} />
            <div className="flex flex-wrap gap-2 py-1">
              <Link href={`/admin/orders/${r.orderId}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                Order #{shortId(r.orderId)}
                {r.orderStatus && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${orderStatusChip(r.orderStatus)}`}>
                    {r.orderStatus}
                  </span>
                )}
              </Link>
              {r.supportTicketId && (
                <Link href={`/admin/support/${r.supportTicketId}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                  Linked ticket #{shortId(r.supportTicketId)}
                </Link>
              )}
            </div>
            <Row label="Album" value={r.albumTitle ?? '—'} />
            <div className="pt-2">
              <p className="mb-1 text-xs text-muted-foreground">Customer’s message</p>
              <p className="whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed">
                {r.description}
              </p>
            </div>
          </Section>

          <Section title="Admin notes">
            {r.adminNotes ? (
              <p className="whitespace-pre-wrap rounded-lg border bg-amber-500/5 p-3 text-sm leading-relaxed">
                {r.adminNotes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
            {r.resolvedBy && (
              <p className="mt-2 text-xs text-muted-foreground">
                Last decided by {actorEmails.get(r.resolvedBy) ?? 'admin'} · {fmtDateTime(r.resolvedAt as string)}
              </p>
            )}
          </Section>

          <Section title="Audit trail">
            {audits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {audits.map((a) => {
                  const meta = (a.metadata ?? {}) as Record<string, unknown>;
                  const who =
                    a.actorType === 'system'
                      ? 'System'
                      : a.actorType === 'customer'
                        ? r.customerName ?? 'Customer'
                        : (a.actorId && actorEmails.get(a.actorId)) || 'admin';
                  let detail = '';
                  if (a.action.endsWith('status_changed')) detail = `${meta.from} → ${meta.to}`;
                  return (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 last:border-0">
                      <span className="font-medium">{AUDIT_LABEL[a.action] ?? a.action}</span>
                      {detail && <span className="text-muted-foreground">{detail}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {who} · {fmtDateTime(a.createdAt as unknown as string)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Decision</h2>
          <RequestActions kind={kind} requestId={r.id} status={r.status} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
