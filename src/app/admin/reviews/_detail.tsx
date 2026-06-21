import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  albumReviews,
  revisionRequests,
  albums,
  profiles,
  orders,
  supportTickets,
  refundRequests,
  reprintRequests,
  auditLog,
} from '@/db/schema';
import { adminUserEmail, adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import { getAlbumReadiness } from '@/lib/admin/readiness';
import {
  reviewStatusLabel,
  reviewStatusChip,
  revisionStatusLabel,
  revisionStatusChip,
} from '@/lib/reviews/model';
import ReviewActions from './_actions';

const AUDIT_LABEL: Record<string, string> = {
  'review.created': 'Submitted for review',
  'review.resubmitted': 'Resubmitted for review',
  'review.status_changed': 'Decision',
  'review.note_added': 'Note added',
  'revision.opened': 'Changes requested',
  'revision.in_progress': 'Customer started editing',
  'revision.resubmitted': 'Customer resubmitted',
  'revision.completed': 'Revision completed',
};

export default async function ReviewDetail({ id }: { id: string }) {
  const [review] = await db
    .select({
      id: albumReviews.id,
      albumId: albumReviews.albumId,
      status: albumReviews.status,
      reviewNotes: albumReviews.reviewNotes,
      createdAt: albumReviews.createdAt,
      updatedAt: albumReviews.updatedAt,
      reviewedAt: albumReviews.reviewedAt,
      reviewedBy: albumReviews.reviewedBy,
      customerId: albumReviews.customerId,
      customerName: profiles.name,
      customerPhone: profiles.phone,
      albumTitle: albums.title,
      albumSize: albums.size,
      albumStatus: albums.status,
    })
    .from(albumReviews)
    .leftJoin(profiles, eq(albumReviews.customerId, profiles.id))
    .leftJoin(albums, eq(albumReviews.albumId, albums.id))
    .where(eq(albumReviews.id, id))
    .limit(1);

  if (!review) notFound();

  // Revisions (history) + their ids for the audit query.
  const revisions = await db
    .select({
      id: revisionRequests.id,
      requestedChanges: revisionRequests.requestedChanges,
      status: revisionRequests.status,
      createdAt: revisionRequests.createdAt,
      completedAt: revisionRequests.completedAt,
    })
    .from(revisionRequests)
    .where(eq(revisionRequests.albumReviewId, review.id))
    .orderBy(desc(revisionRequests.createdAt));

  // Readiness (existing engine — never duplicated) + linked records for this album.
  const albumOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.albumId, review.albumId));
  const orderIds = albumOrders.map((o) => o.id);

  const [readiness, tickets, refunds, reprints] = await Promise.all([
    getAlbumReadiness(review.albumId),
    db
      .select({ id: supportTickets.id, subject: supportTickets.subject, status: supportTickets.status })
      .from(supportTickets)
      .where(
        orderIds.length
          ? or(eq(supportTickets.albumId, review.albumId), inArray(supportTickets.orderId, orderIds))!
          : eq(supportTickets.albumId, review.albumId),
      )
      .limit(10),
    orderIds.length
      ? db
          .select({ id: refundRequests.id, status: refundRequests.status })
          .from(refundRequests)
          .where(inArray(refundRequests.orderId, orderIds))
          .limit(10)
      : Promise.resolve([] as { id: string; status: string }[]),
    orderIds.length
      ? db
          .select({ id: reprintRequests.id, status: reprintRequests.status })
          .from(reprintRequests)
          .where(inArray(reprintRequests.orderId, orderIds))
          .limit(10)
      : Promise.resolve([] as { id: string; status: string }[]),
  ]);

  // Audit: album_review events keyed on the review id + revision events keyed on revision ids.
  const revisionIds = revisions.map((r) => r.id);
  const audits = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorId: auditLog.actorId,
      actorType: auditLog.actorType,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      revisionIds.length
        ? sql`(${auditLog.entityType} = 'album_review' and ${auditLog.entityId} = ${review.id})
               or (${auditLog.entityType} = 'revision_request' and ${auditLog.entityId} in (${sql.join(
                 revisionIds.map((rid) => sql`${rid}::uuid`),
                 sql`, `,
               )}))`
        : sql`${auditLog.entityType} = 'album_review' and ${auditLog.entityId} = ${review.id}`,
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(40);

  const [email, actorEmails] = await Promise.all([
    adminUserEmail(review.customerId),
    adminUserEmails(
      [...audits.map((a) => a.actorId).filter(Boolean), review.reviewedBy].filter(Boolean) as string[],
    ),
  ]);

  const activeRevision = revisions.find((r) => ['open', 'in_progress', 'resubmitted'].includes(r.status));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/reviews" className="hover:underline">
          Album Reviews
        </Link>
        {' / '}#{shortId(review.id)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{review.albumTitle ?? 'Album'}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${reviewStatusChip(review.status)}`}>
          {reviewStatusLabel(review.status)}
        </span>
        <span className="text-sm text-muted-foreground">Updated {fmtDateTime(review.updatedAt as unknown as string)}</span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer">
            <Row label="Name" value={review.customerName ?? '—'} />
            <Row label="Email" value={email || '—'} />
            <Row label="Phone" value={review.customerPhone ?? '—'} />
            <Row
              label="Customer record"
              value={
                <Link href={`/admin/customers/${review.customerId}`} className="text-primary hover:underline">
                  View customer
                </Link>
              }
            />
          </Section>

          <Section title="Album">
            <Row label="Title" value={review.albumTitle ?? '—'} />
            <Row label="Size" value={`${review.albumSize ?? '—'} pages`} />
            <Row label="Album status" value={review.albumStatus ?? '—'} />
            <div className="pt-2">
              <Link href={`/admin/albums/${review.albumId}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                Open album in admin
              </Link>
            </div>
          </Section>

          {readiness && (
            <Section title={`Print readiness · ${readiness.score}/100`}>
              <ul className="space-y-1.5 text-sm">
                {readiness.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${it.ok ? 'bg-success' : 'bg-amber-500'}`} />
                    <span>
                      <span className="font-medium">{it.title}</span>
                      <span className="text-muted-foreground"> — {it.detail}</span>
                      {it.advisory && <span className="ml-1 text-xs text-muted-foreground">(advisory)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {review.reviewNotes && (
            <Section title="Latest note to customer">
              <p className="whitespace-pre-wrap rounded-lg border bg-amber-500/5 p-3 text-sm leading-relaxed">
                {review.reviewNotes}
              </p>
              {review.reviewedBy && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Last decided by {actorEmails.get(review.reviewedBy) ?? 'admin'} ·{' '}
                  {fmtDateTime(review.reviewedAt as unknown as string)}
                </p>
              )}
            </Section>
          )}

          <Section title="Revision history">
            {revisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes have been requested.</p>
            ) : (
              <ul className="space-y-3">
                {revisions.map((rev) => (
                  <li key={rev.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${revisionStatusChip(rev.status)}`}>
                        {revisionStatusLabel(rev.status)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Requested {fmtDateTime(rev.createdAt as unknown as string)}
                        {rev.completedAt ? ` · Completed ${fmtDateTime(rev.completedAt as unknown as string)}` : ''}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{rev.requestedChanges}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(tickets.length > 0 || refunds.length > 0 || reprints.length > 0) && (
            <Section title="Linked records">
              <div className="flex flex-wrap gap-2">
                {tickets.map((t) => (
                  <Link key={t.id} href={`/admin/support/${t.id}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Ticket #{shortId(t.id)} · {t.status}
                  </Link>
                ))}
                {refunds.map((rf) => (
                  <Link key={rf.id} href={`/admin/refunds/${rf.id}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Refund #{shortId(rf.id)} · {rf.status}
                  </Link>
                ))}
                {reprints.map((rp) => (
                  <Link key={rp.id} href={`/admin/reprints/${rp.id}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Reprint #{shortId(rp.id)} · {rp.status}
                  </Link>
                ))}
              </div>
            </Section>
          )}

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
                        ? review.customerName ?? 'Customer'
                        : (a.actorId && actorEmails.get(a.actorId)) || 'admin';
                  let detail = '';
                  if (a.action === 'review.status_changed') detail = `${meta.from} → ${meta.to}`;
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
          <h2 className="text-sm font-semibold">Review decision</h2>
          {activeRevision && review.status === 'changes_requested' && (
            <p className="rounded-lg border bg-amber-500/5 p-2 text-xs text-muted-foreground">
              Awaiting the customer’s resubmission.
            </p>
          )}
          <ReviewActions reviewId={review.id} status={review.status} />
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
