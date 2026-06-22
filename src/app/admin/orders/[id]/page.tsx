import { notFound } from 'next/navigation';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  orders,
  albums,
  coupons,
  addresses,
  payments,
  orderNotes,
  auditLog,
  profiles,
  emailLog,
  shipments,
  shipmentEvents,
  albumReviews,
  refundRequests,
  reprintRequests,
  supportTickets,
} from '@/db/schema';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail, adminUserEmails } from '@/lib/admin/users';
import { inr } from '@/lib/admin/format';
import OrderConsole, { type ConsoleAudit, type ConsoleNote } from './_console';
import { type ShipmentView } from './_operations';

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
      .select({ id: emailLog.id, eventType: emailLog.eventType, recipient: emailLog.recipient, status: emailLog.status, createdAt: emailLog.createdAt })
      .from(emailLog)
      .where(eq(emailLog.orderId, row.id))
      .orderBy(desc(emailLog.createdAt))
      .limit(15),
  ]);

  // Actor/author names for the notes + audit panels.
  const actorIds = [...notes.map((n) => n.authorId).filter(Boolean), ...audits.map((a) => a.actorId).filter(Boolean)] as string[];
  const actorEmails = await adminUserEmails(actorIds);

  // Supplemental shipment (one per order) + its append-only events (Phase 9F).
  const [shipmentRow] = await db.select().from(shipments).where(eq(shipments.orderId, row.id)).limit(1);
  const shipmentEventRows = shipmentRow
    ? await db
        .select({ id: shipmentEvents.id, eventType: shipmentEvents.eventType, description: shipmentEvents.description, occurredAt: shipmentEvents.occurredAt })
        .from(shipmentEvents)
        .where(eq(shipmentEvents.shipmentId, shipmentRow.id))
        .orderBy(desc(shipmentEvents.occurredAt))
    : [];
  const shipmentView: ShipmentView = shipmentRow
    ? {
        id: shipmentRow.id,
        courier: shipmentRow.courier,
        trackingNumber: shipmentRow.trackingNumber,
        shipmentStatus: shipmentRow.shipmentStatus,
        externalReference: shipmentRow.externalReference,
        events: shipmentEventRows.map((e) => ({ id: e.id, eventType: e.eventType, description: e.description, occurredAt: e.occurredAt as unknown as string })),
      }
    : null;

  // Related records (read-only contextual links — shown only when they exist).
  const [reviewRow, refundRow, reprintRow, supportRow] = await Promise.all([
    db.select({ id: albumReviews.id, status: albumReviews.status }).from(albumReviews).where(eq(albumReviews.albumId, row.albumId)).limit(1),
    db.select({ id: refundRequests.id, status: refundRequests.status }).from(refundRequests).where(eq(refundRequests.orderId, row.id)).orderBy(desc(refundRequests.createdAt)).limit(1),
    db.select({ id: reprintRequests.id, status: reprintRequests.status }).from(reprintRequests).where(eq(reprintRequests.orderId, row.id)).orderBy(desc(reprintRequests.createdAt)).limit(1),
    db.select({ id: supportTickets.id, status: supportTickets.status }).from(supportTickets).where(eq(supportTickets.orderId, row.id)).orderBy(desc(supportTickets.updatedAt)).limit(1),
  ]);

  // PDF status (album_pdfs is service-only; ownership already proven by the admin gate).
  const svc = createServiceClient();
  const { data: pdfRow } = await svc.from('album_pdfs').select('status').eq('album_id', row.albumId).maybeSingle();
  const pdfStatus = ((pdfRow as { status: string } | null)?.status ?? 'idle');

  const fullAddress = row.addrName
    ? `${row.addrName}, ${row.addrLine1}, ${row.addrCity}, ${row.addrState} — ${row.addrPincode}`
    : '—';

  // Precompute display strings server-side so the client console stays presentation-only.
  const notesView: ConsoleNote[] = notes.map((n) => ({
    id: n.id,
    body: n.body,
    author: (n.authorId && actorEmails.get(n.authorId)) || 'admin',
    createdAt: n.createdAt as unknown as string,
  }));
  const auditsView: ConsoleAudit[] = audits.map((a) => {
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const who = a.actorType === 'system' ? 'System' : (a.actorId && actorEmails.get(a.actorId)) || 'admin';
    let detail = '';
    if (a.action === 'order.status_changed') detail = `${meta.from} → ${meta.to}`;
    else if (a.action === 'order.shipping_set') detail = `${meta.carrier} · ${meta.tracking_number}`;
    else if (a.action === 'coupon.redeemed') detail = `${meta.code} (−${inr(String(meta.amount_discounted))})`;
    return { id: a.id, label: AUDIT_LABEL[a.action] ?? a.action, detail, who, createdAt: a.createdAt as unknown as string };
  });

  return (
    <OrderConsole
      order={{
        id: row.id,
        status: row.status,
        placedAt: row.placedAt as unknown as string,
        userId: row.userId,
        albumId: row.albumId,
        albumTitle: row.albumTitle,
        albumStatus: row.albumStatus,
        tracking: row.trackingNumber,
        carrier: row.carrier,
      }}
      customer={{ name: row.customerName, email, phone: row.customerPhone, address: fullAddress, orderCount }}
      payment={{
        subtotal: row.subtotal,
        shipping: row.shipping,
        discount: row.discount,
        total: row.total,
        couponCode: row.couponCode,
        method: payment?.method ?? null,
        capturedAt: (payment?.capturedAt as unknown as string) ?? null,
      }}
      pdfStatus={pdfStatus}
      shipment={shipmentView}
      notes={notesView}
      audits={auditsView}
      emails={emails.map((m) => ({ id: m.id, eventType: m.eventType, recipient: m.recipient, status: m.status, createdAt: m.createdAt as unknown as string }))}
      related={{
        review: reviewRow[0] ?? null,
        refund: refundRow[0] ?? null,
        reprint: reprintRow[0] ?? null,
        support: supportRow[0] ?? null,
      }}
    />
  );
}
