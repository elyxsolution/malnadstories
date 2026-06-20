import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { orders, albums, coupons, addresses, payments, orderNotes, auditLog, profiles, emailLog } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail, adminUserEmails } from '@/lib/admin/users';
import { inr, shortId, fmtDateTime, statusChip } from '@/lib/admin/format';
import { adminStatusLabel } from '@/lib/orders/status';
import Fulfillment from './_fulfillment';
import AdminPdfDownload from '../../_pdf-download';

const AUDIT_LABEL: Record<string, string> = {
  'order.status_changed': 'Status changed',
  'order.shipping_set': 'Tracking updated',
  'order.note_added': 'Note added',
  'coupon.redeemed': 'Coupon redeemed',
};

export default async function AdminOrderDetail({ params }: { params: { id: string } }) {
  await requireAdmin();

  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      userId: orders.userId,
      customerName: profiles.name,
      customerPhone: profiles.phone,
      albumId: orders.albumId,
      albumTitle: albums.title,
      albumStatus: albums.status,
      copies: orders.copies,
      subtotal: orders.subtotalAmount,
      shipping: orders.shippingAmount,
      discount: orders.discountAmount,
      total: orders.totalAmount,
      couponCode: coupons.code,
      trackingNumber: orders.trackingNumber,
      carrier: orders.carrier,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
      placedAt: orders.placedAt,
      addrName: addresses.fullName,
      addrLine1: addresses.line1,
      addrCity: addresses.city,
      addrState: addresses.state,
      addrPincode: addresses.pincode,
    })
    .from(orders)
    .leftJoin(albums, eq(orders.albumId, albums.id))
    .leftJoin(coupons, eq(orders.couponId, coupons.id))
    .leftJoin(addresses, eq(orders.addressId, addresses.id))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .where(eq(orders.id, params.id))
    .limit(1);

  if (!row) notFound();

  const [email, [{ c: orderCount }], [payment], notes, audits, emails] = await Promise.all([
    adminUserEmail(row.userId),
    db.select({ c: count() }).from(orders).where(eq(orders.userId, row.userId)),
    db
      .select({ method: payments.method, status: payments.status, capturedAt: payments.capturedAt })
      .from(payments)
      .where(and(eq(payments.orderId, row.id), eq(payments.status, 'captured')))
      .orderBy(desc(payments.capturedAt))
      .limit(1),
    db
      .select({ id: orderNotes.id, body: orderNotes.body, authorId: orderNotes.authorId, createdAt: orderNotes.createdAt })
      .from(orderNotes)
      .where(eq(orderNotes.orderId, row.id))
      .orderBy(desc(orderNotes.createdAt)),
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
      .where(
        sql`(${auditLog.entityType} = 'order' and ${auditLog.entityId} = ${row.id}) or (${auditLog.metadata}->>'order_id' = ${row.id})`,
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(25),
    db
      .select({
        id: emailLog.id,
        eventType: emailLog.eventType,
        recipient: emailLog.recipient,
        status: emailLog.status,
        createdAt: emailLog.createdAt,
      })
      .from(emailLog)
      .where(eq(emailLog.orderId, row.id))
      .orderBy(desc(emailLog.createdAt))
      .limit(15),
  ]);

  // Resolve actor + author names for the notes/audit panels.
  const actorIds = [
    ...notes.map((n) => n.authorId).filter(Boolean),
    ...audits.map((a) => a.actorId).filter(Boolean),
  ] as string[];
  const actorEmails = await adminUserEmails(actorIds);

  const fullAddress = row.addrName
    ? `${row.addrName}, ${row.addrLine1}, ${row.addrCity}, ${row.addrState} — ${row.addrPincode}`
    : '—';

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/orders" className="hover:underline">
          Orders
        </Link>
        {' / '}#{shortId(row.id)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-bold">#{shortId(row.id)}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(row.status)}`}>
          {adminStatusLabel(row.status)}
        </span>
        <span className="text-sm text-muted-foreground">Placed {fmtDateTime(row.placedAt as unknown as string)}</span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left column: customer, album, payment */}
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer">
            <Row label="Name" value={row.customerName ?? '—'} />
            <Row label="Email" value={email || '—'} />
            <Row label="Phone" value={row.customerPhone ?? '—'} />
            <Row label="Delivery address" value={fullAddress} />
            <Row
              label="Order history"
              value={
                <Link href={`/admin/customers/${row.userId}`} className="text-primary hover:underline">
                  {orderCount} order{orderCount === 1 ? '' : 's'}
                </Link>
              }
            />
          </Section>

          <Section title="Album">
            <Row label="Title" value={row.albumTitle ?? '—'} />
            <Row label="Album status" value={row.albumStatus ?? '—'} />
            <div className="flex flex-wrap gap-2 pt-2">
              <Link
                href={`/admin/albums/${row.albumId}`}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
              >
                View album
              </Link>
              <AdminPdfDownload albumId={row.albumId} />
            </div>
          </Section>

          <Section title="Payment">
            <Row label="Subtotal" value={inr(row.subtotal)} />
            <Row label="Shipping" value={inr(row.shipping)} />
            <Row label="Discount" value={Number(row.discount) > 0 ? `− ${inr(row.discount)}` : inr(0)} />
            <Row label="Coupon" value={row.couponCode ?? '—'} />
            <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{inr(row.total)}</span>
            </div>
            <Row label="Payment method" value={payment?.method ?? '—'} />
            <Row label="Payment date" value={fmtDateTime(payment?.capturedAt as unknown as string)} />
          </Section>

          <Section title={`Internal notes (${notes.length})`}>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(n.authorId && actorEmails.get(n.authorId)) || 'admin'} ·{' '}
                      {fmtDateTime(n.createdAt as unknown as string)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Audit trail">
            {audits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audit events yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {audits.map((a) => {
                  const meta = (a.metadata ?? {}) as Record<string, unknown>;
                  const who = a.actorType === 'system' ? 'System' : (a.actorId && actorEmails.get(a.actorId)) || 'admin';
                  let detail = '';
                  if (a.action === 'order.status_changed') detail = `${meta.from} → ${meta.to}`;
                  else if (a.action === 'order.shipping_set') detail = `${meta.carrier} · ${meta.tracking_number}`;
                  else if (a.action === 'coupon.redeemed') detail = `${meta.code} (−${inr(String(meta.amount_discounted))})`;
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

          <Section title={`Email activity (${emails.length})`}>
            {emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No emails sent for this order.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {emails.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 last:border-0">
                    <span className="font-medium">{m.eventType}</span>
                    <span className="text-muted-foreground">{m.recipient}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.status === 'sent'
                          ? 'bg-green-500/10 text-green-600'
                          : m.status === 'failed'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {m.status}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtDateTime(m.createdAt as unknown as string)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {/* Right column: fulfillment controls */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Fulfilment</h2>
          <Fulfillment
            orderId={row.id}
            status={row.status}
            trackingNumber={row.trackingNumber}
            carrier={row.carrier}
          />
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
