'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ImageIcon, StickyNote, ScrollText, Mail, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inr, shortId, fmtDateTime, statusChip } from '@/lib/admin/format';
import { adminStatusLabel } from '@/lib/orders/status';
import { addOrderNote } from '@/lib/actions/admin/orders';
import AdminPdfDownload from '../../_pdf-download';
import Operations, { type ShipmentView } from './_operations';

type Tab = 'overview' | 'fulfilment' | 'activity';

export type ConsoleOrder = {
  id: string;
  status: string;
  placedAt: string;
  userId: string;
  albumId: string;
  albumTitle: string | null;
  albumStatus: string | null;
  tracking: string | null;
  carrier: string | null;
};
/**
 * One purchased line (0056) — the snapshot as sold, not today's catalog.
 *
 * `albumStatus` and `pdfStatus` are LIVE per-album state (not snapshots), because that is what an
 * operator acts on: for a combined order a single order-level PDF chip would describe only the
 * first album and quietly hide the others. Regeneration itself stays where it already is —
 * `adminGenerateAlbumPdf(albumId)` on `/admin/albums/[id]`, which each row links to — so no new
 * mutation surface, no order-level PDF, and `previewPdfKey`/PDF idempotency are untouched.
 */
export type ConsoleItem = {
  id: string;
  albumId: string;
  albumTitle: string;
  productName: string | null;
  productDimensions: unknown;
  copies: number;
  unitPrice: string | number;
  lineSubtotal: string | number;
  albumStatus: string | null;
  pdfStatus: string;
};
export type ConsoleCustomer = { name: string | null; email: string; phone: string | null; address: string; orderCount: number };
export type ConsolePayment = {
  subtotal: string | number;
  shipping: string | number;
  discount: string | number;
  total: string | number;
  couponCode: string | null;
  method: string | null;
  capturedAt: string | null;
};
export type RelatedRecord = { id: string; status: string } | null;
export type ConsoleRelated = { review: RelatedRecord; refund: RelatedRecord; reprint: RelatedRecord; support: RelatedRecord };
export type ConsoleNote = { id: string; body: string; author: string; createdAt: string };
export type ConsoleAudit = { id: string; label: string; detail: string; who: string; createdAt: string };
export type ConsoleEmail = { id: string; eventType: string; recipient: string; status: string; createdAt: string };

const PDF_CHIP: Record<string, string> = {
  ready: 'bg-success/10 text-success',
  generating: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
  idle: 'bg-muted text-muted-foreground',
};

/** The purchased dimensions snapshot ("21 × 29.7 cm"), or null when a line predates it. */
function dimsOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as { widthCm?: unknown; heightCm?: unknown };
  return typeof d.widthCm === 'number' && typeof d.heightCm === 'number' ? `${d.widthCm} × ${d.heightCm} cm` : null;
}

/**
 * Unified premium order console (Phase 10E.1). ONE operational surface: a sticky header,
 * three tabs (Overview / Fulfilment & Shipping / Activity), and a single Operations panel.
 * Every action still calls the exact same server actions — this is a presentation-only
 * consolidation. No backend, lifecycle, schema, payment, RBAC, or audit change.
 */
export default function OrderConsole({
  order,
  items,
  customer,
  payment,
  pdfStatus,
  shipment,
  notes,
  audits,
  emails,
  related,
}: {
  order: ConsoleOrder;
  items: ConsoleItem[];
  customer: ConsoleCustomer;
  payment: ConsolePayment;
  pdfStatus: string;
  shipment: ShipmentView;
  notes: ConsoleNote[];
  audits: ConsoleAudit[];
  emails: ConsoleEmail[];
  related: ConsoleRelated;
}) {
  const [tab, setTab] = useState<Tab>('overview');

  const relatedLinks: { label: string; href: string; status: string }[] = [];
  if (related.review) relatedLinks.push({ label: 'Review', href: `/admin/reviews/${related.review.id}`, status: related.review.status });
  if (related.refund) relatedLinks.push({ label: 'Refund', href: `/admin/refunds/${related.refund.id}`, status: related.refund.status });
  if (related.reprint) relatedLinks.push({ label: 'Reprint', href: `/admin/reprints/${related.reprint.id}`, status: related.reprint.status });
  if (related.support) relatedLinks.push({ label: 'Support', href: `/admin/support/${related.support.id}`, status: related.support.status });

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'fulfilment', label: 'Fulfilment & Shipping' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/orders" className="hover:underline">Orders</Link>
        {' / '}#{shortId(order.id)}
      </p>

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 -mx-4 mt-1 border-b bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-bold">#{shortId(order.id)}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(order.status)}`}>{adminStatusLabel(order.status)}</span>
            <span className="text-sm text-muted-foreground">Placed {fmtDateTime(order.placedAt)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AdminPdfDownload albumId={order.albumId} />
            <Button variant="outline" size="sm" render={<Link href={`/admin/albums/${order.albumId}`} />}>
              <ImageIcon /> View album
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="mt-3 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Customer">
              <Row label="Name" value={customer.name ?? '—'} />
              <Row label="Email" value={customer.email || '—'} />
              <Row label="Phone" value={customer.phone ?? '—'} />
              <Row label="Delivery address" value={customer.address} />
              <Row label="Order history" value={<Link href={`/admin/customers/${order.userId}`} className="text-primary hover:underline">{customer.orderCount} order{customer.orderCount === 1 ? '' : 's'}</Link>} />
            </Section>

            {/*
              ALBUMS IN THIS ORDER, from `order_items` (Phase 8) — an order can contain several,
              and `orders.album_id` names only the first. Each row links to its album and shows
              the purchased copies and line total (the snapshot, not today's catalog). A
              single-album order therefore reads as it always did, with one line.
              `Album status` / `PDF` still describe the FIRST album, which is what the existing
              per-album columns on `orders` point at.
            */}
            <Section title={items.length > 1 ? `Albums (${items.length})` : 'Album'}>
              {items.length > 0 ? (
                <div className="flex flex-col divide-y">
                  {items.map((it) => (
                    <div key={it.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/admin/albums/${it.albumId}`} className="block truncate text-sm font-medium text-primary hover:underline">
                          {it.albumTitle}
                        </Link>
                        {/* Product name AND dimensions come from the purchase snapshot, so a later
                            catalog edit cannot restate what this order sold. */}
                        <p className="text-xs text-muted-foreground">
                          {it.productName ?? 'Album'}
                          {dimsOf(it.productDimensions) ? ` · ${dimsOf(it.productDimensions)}` : ''} · {inr(it.unitPrice)} ×{' '}
                          {it.copies}
                        </p>
                        {/* Per-album live state: for a combined order each book prints, reviews and
                            regenerates on its own, so each one shows its own status here. */}
                        <p className="mt-1 flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">{it.albumStatus ?? '—'}</span>
                          <span className="text-muted-foreground/50">·</span>
                          <span className={`rounded-full px-2 py-0.5 font-medium ${PDF_CHIP[it.pdfStatus] ?? PDF_CHIP.idle}`}>
                            PDF {it.pdfStatus}
                          </span>
                        </p>
                      </div>
                      <span className="flex-none text-sm tabular-nums">{inr(it.lineSubtotal)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <Row label="Title" value={order.albumTitle ?? '—'} />
                  <Row label="Album status" value={order.albumStatus ?? '—'} />
                  <Row label="PDF" value={<span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PDF_CHIP[pdfStatus] ?? PDF_CHIP.idle}`}>{pdfStatus}</span>} />
                </>
              )}
              {items.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Regenerate a PDF (reprint) from that album&apos;s page — it is per album, never
                  order-wide.
                </p>
              )}
            </Section>

            <Section title="Payment">
              <Row label="Subtotal" value={inr(payment.subtotal)} />
              <Row label="Shipping" value={inr(payment.shipping)} />
              <Row label="Discount" value={Number(payment.discount) > 0 ? `− ${inr(payment.discount)}` : inr(0)} />
              <Row label="Coupon" value={payment.couponCode ?? '—'} />
              <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span>{inr(payment.total)}</span>
              </div>
              <Row label="Payment method" value={payment.method ?? '—'} />
              <Row label="Payment date" value={payment.capturedAt ? fmtDateTime(payment.capturedAt) : '—'} />
            </Section>

            <Section title="Related records">
              {relatedLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reviews, refunds, reprints, or tickets for this order.</p>
              ) : (
                <ul className="space-y-2">
                  {relatedLinks.map((r) => (
                    <li key={r.label}>
                      <Link href={r.href} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-muted">
                        <span className="font-medium">{r.label}</span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{r.status}</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}

        {tab === 'fulfilment' && (
          <div className="mx-auto max-w-2xl">
            <Operations
              orderId={order.id}
              orderStatus={order.status}
              orderTracking={order.tracking}
              orderCarrier={order.carrier}
              shipment={shipment}
            />
          </div>
        )}

        {tab === 'activity' && (
          <div className="space-y-6">
            <NotesBlock orderId={order.id} notes={notes} />
            <Section title="Audit trail" icon={<ScrollText className="h-4 w-4" />}>
              {audits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit events yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {audits.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 last:border-0">
                      <span className="font-medium">{a.label}</span>
                      {a.detail && <span className="text-muted-foreground">{a.detail}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{a.who} · {fmtDateTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={`Email activity (${emails.length})`} icon={<Mail className="h-4 w-4" />}>
              {emails.length === 0 ? (
                <p className="text-sm text-muted-foreground">No emails sent for this order.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {emails.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 last:border-0">
                      <span className="font-medium">{m.eventType}</span>
                      <span className="text-muted-foreground">{m.recipient}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.status === 'sent' ? 'bg-success/10 text-success' : m.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                        {m.status}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function NotesBlock({ orderId, notes }: { orderId: string; notes: ConsoleNote[] }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setErr(null);
    const res = await addOrderNote({ orderId, body: note.trim() });
    setBusy(false);
    if (res.ok) {
      setNote('');
      router.refresh();
    } else {
      setErr(res.error ?? 'Could not add the note.');
    }
  };

  return (
    <Section title={`Internal notes (${notes.length})`} icon={<StickyNote className="h-4 w-4" />}>
      <div className="space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Visible to admins only…"
          className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy || !note.trim()} onClick={add}>
            {busy ? <InlineLoader /> : <StickyNote />} Add note
          </Button>
          {err && <span className="text-xs text-destructive">{err}</span>}
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{n.author} · {fmtDateTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</h2>
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
