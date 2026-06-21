import Link from 'next/link';
import { notFound } from 'next/navigation';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { supportTickets, supportMessages, profiles, albums, orders, auditLog } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmail, adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import { categoryLabel, priorityLabel, adminStatusLabel, statusChip, priorityChip } from '@/lib/support/model';
import SupportActions from './_admin-actions';

const AUDIT_LABEL: Record<string, string> = {
  'support.ticket_created': 'Ticket created',
  'support.replied': 'Reply posted',
  'support.note_added': 'Internal note added',
  'support.status_changed': 'Status changed',
  'support.assigned': 'Assignment changed',
};

export default async function AdminSupportDetail({ params }: { params: { id: string } }) {
  const admin = await requireAdmin();

  const [ticket] = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      description: supportTickets.description,
      category: supportTickets.category,
      priority: supportTickets.priority,
      status: supportTickets.status,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      resolvedAt: supportTickets.resolvedAt,
      assignedTo: supportTickets.assignedTo,
      customerId: supportTickets.customerId,
      customerName: profiles.name,
      customerPhone: profiles.phone,
      albumId: supportTickets.albumId,
      albumTitle: albums.title,
      orderId: supportTickets.orderId,
      orderStatus: orders.status,
    })
    .from(supportTickets)
    .leftJoin(profiles, eq(supportTickets.customerId, profiles.id))
    .leftJoin(albums, eq(supportTickets.albumId, albums.id))
    .leftJoin(orders, eq(supportTickets.orderId, orders.id))
    .where(eq(supportTickets.id, params.id))
    .limit(1);

  if (!ticket) notFound();

  const [email, messages, audits] = await Promise.all([
    adminUserEmail(ticket.customerId),
    db
      .select({
        id: supportMessages.id,
        senderType: supportMessages.senderType,
        senderId: supportMessages.senderId,
        body: supportMessages.body,
        isInternal: supportMessages.isInternal,
        createdAt: supportMessages.createdAt,
      })
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, ticket.id))
      .orderBy(asc(supportMessages.createdAt)),
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
      .where(sql`${auditLog.entityType} = 'support_ticket' and ${auditLog.entityId} = ${ticket.id}`)
      .orderBy(desc(auditLog.createdAt))
      .limit(30),
  ]);

  const actorEmails = await adminUserEmails([
    ...messages.map((m) => m.senderId).filter(Boolean),
    ...audits.map((a) => a.actorId).filter(Boolean),
    ticket.assignedTo,
  ].filter(Boolean) as string[]);

  const assignedLabel = ticket.assignedTo ? actorEmails.get(ticket.assignedTo) ?? 'an admin' : null;
  const assignedToMe = ticket.assignedTo === admin.userId;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/support" className="hover:underline">
          Support
        </Link>
        {' / '}#{shortId(ticket.id)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{ticket.subject}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(ticket.status)}`}>
          {adminStatusLabel(ticket.status)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityChip(ticket.priority)}`}>
          {priorityLabel(ticket.priority)}
        </span>
        <span className="text-sm text-muted-foreground">Opened {fmtDateTime(ticket.createdAt as unknown as string)}</span>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left: customer + conversation */}
        <div className="space-y-6 lg:col-span-2">
          <Section title="Customer">
            <Row label="Name" value={ticket.customerName ?? '—'} />
            <Row label="Email" value={email || '—'} />
            <Row label="Phone" value={ticket.customerPhone ?? '—'} />
            <Row
              label="Customer record"
              value={
                <Link href={`/admin/customers/${ticket.customerId}`} className="text-primary hover:underline">
                  View customer
                </Link>
              }
            />
            <Row label="Category" value={categoryLabel(ticket.category)} />
            {(ticket.albumId || ticket.orderId) && (
              <div className="flex flex-wrap gap-2 pt-2">
                {ticket.albumId && (
                  <Link href={`/admin/albums/${ticket.albumId}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Album: {ticket.albumTitle ?? '—'}
                  </Link>
                )}
                {ticket.orderId && (
                  <Link href={`/admin/orders/${ticket.orderId}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
                    Order #{shortId(ticket.orderId)} · {ticket.orderStatus ?? '—'}
                  </Link>
                )}
              </div>
            )}
          </Section>

          <Section title="Conversation">
            <div className="space-y-3">
              {/* Opening message */}
              <Message who={ticket.customerName ?? 'Customer'} time={fmtDateTime(ticket.createdAt as unknown as string)} variant="customer">
                {ticket.description}
              </Message>
              {messages.map((m) => (
                <Message
                  key={m.id}
                  who={
                    m.senderType === 'admin'
                      ? (m.senderId && actorEmails.get(m.senderId)) || 'Admin'
                      : ticket.customerName ?? 'Customer'
                  }
                  time={fmtDateTime(m.createdAt as unknown as string)}
                  variant={m.isInternal ? 'internal' : m.senderType === 'admin' ? 'admin' : 'customer'}
                >
                  {m.body}
                </Message>
              ))}
            </div>
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
                        ? ticket.customerName ?? 'Customer'
                        : (a.actorId && actorEmails.get(a.actorId)) || 'admin';
                  let detail = '';
                  if (a.action === 'support.status_changed') detail = `${meta.from} → ${meta.to}`;
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

        {/* Right: actions */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Manage</h2>
          <SupportActions
            ticketId={ticket.id}
            status={ticket.status}
            assignedToMe={assignedToMe}
            assignedLabel={assignedLabel}
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

function Message({
  who,
  time,
  variant,
  children,
}: {
  who: string;
  time: string;
  variant: 'customer' | 'admin' | 'internal';
  children: React.ReactNode;
}) {
  const cls =
    variant === 'internal'
      ? 'border-amber-500/30 bg-amber-500/5'
      : variant === 'admin'
        ? 'border-primary/20 bg-primary/5'
        : 'border-border bg-muted/20';
  return (
    <div className={`rounded-lg border ${cls} p-3 text-sm`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{who}</span>
        {variant === 'internal' && (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-600">
            Internal
          </span>
        )}
        <span className="ml-auto">{time}</span>
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{children}</p>
    </div>
  );
}
