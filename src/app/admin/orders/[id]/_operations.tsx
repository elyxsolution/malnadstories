'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight, Truck, PackageCheck, RefreshCw, XCircle, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateOrderStatus, setTracking } from '@/lib/actions/admin/orders';
import { createShipment, updateShipment, setShipmentStatus, cancelShipment, syncTracking } from '@/lib/actions/admin/shipments';
import {
  COURIERS,
  courierLabel,
  shipmentStatusLabel,
  shipmentStatusChip,
  allowedNextShipmentStatuses,
  type CourierName,
  type ShipmentStatus,
} from '@/lib/shipping/model';
import { adminStatusLabel } from '@/lib/orders/status';
import { fmtDateTime } from '@/lib/admin/format';

export type ShipmentView = {
  id: string;
  courier: string;
  trackingNumber: string | null;
  shipmentStatus: string;
  externalReference: string | null;
  events: { id: string; eventType: string; description: string | null; occurredAt: string }[];
} | null;

// Forward-only adjacency (mirrors admin_update_order_status — display only; the RPC re-enforces it).
const NEXT: Record<string, string> = {
  paid: 'processing',
  processing: 'printing',
  printing: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
};
const TERMINAL = new Set(['delivered', 'cancelled', 'failed', 'pending']);
const ORDER_FLOW = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'] as const;
const SHIP_FLOW: ShipmentStatus[] = ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];

// ONE courier vocabulary in the UI (COURIERS, backing the shipments table). Mapped to the
// orders.carrier enum (CARRIERS) only so setTracking() can satisfy the order-status RPC's
// packed→shipped gate. UI mapping only — no schema change.
const COURIER_TO_CARRIER: Record<CourierName, string> = {
  delhivery: 'Delhivery',
  bluedart: 'Blue Dart',
  dtdc: 'DTDC',
  shiprocket: 'Other',
  other: 'Other',
};

type Msg = { kind: 'ok' | 'err'; text: string } | null;

/**
 * THE single operations surface for an order (Phase 10E.1). Merges the former _fulfillment +
 * _shipment panels: one order-status ladder, ONE courier + ONE tracking field, and the
 * shipment progress/controls. "Save tracking" orchestrates the EXISTING actions —
 * setTracking() (orders.tracking_number, required by the status RPC) AND create/updateShipment()
 * (shipments) — so the admin enters tracking + courier exactly once. No backend/lifecycle change.
 */
export default function Operations({
  orderId,
  orderStatus,
  orderTracking,
  orderCarrier,
  shipment,
}: {
  orderId: string;
  orderStatus: string;
  orderTracking: string | null;
  orderCarrier: string | null;
  shipment: ShipmentView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [courier, setCourier] = useState<CourierName>((shipment?.courier as CourierName) || 'delhivery');
  const [tracking, setTrackingInput] = useState(shipment?.trackingNumber ?? orderTracking ?? '');

  const next = NEXT[orderStatus];
  const orderEditable = !TERMINAL.has(orderStatus);
  const needsTracking = next === 'shipped' && (!orderTracking || !orderCarrier);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setMsg({ kind: 'ok', text: okText });
      router.refresh();
    } else {
      setMsg({ kind: 'err', text: res.error ?? 'Something went wrong.' });
    }
  };

  // Save tracking → BOTH existing actions, in one click.
  const saveTracking = async () => {
    const t = tracking.trim();
    if (t.length < 3 || !courier) return;
    setBusy('track');
    setMsg(null);
    const r1 = await setTracking({ orderId, trackingNumber: t, carrier: COURIER_TO_CARRIER[courier] });
    if (!r1.ok) {
      setBusy(null);
      setMsg({ kind: 'err', text: r1.error ?? 'Could not save tracking.' });
      return;
    }
    const r2 = shipment
      ? await updateShipment({ shipmentId: shipment.id, courier, trackingNumber: t })
      : await createShipment({ orderId, courier, trackingNumber: t });
    setBusy(null);
    if (!r2.ok) {
      setMsg({ kind: 'err', text: r2.error ?? 'Order tracking saved, but the shipment record could not be updated.' });
    } else {
      setMsg({ kind: 'ok', text: 'Tracking saved.' });
    }
    router.refresh();
  };

  const shipNext = shipment ? allowedNextShipmentStatuses(shipment.shipmentStatus) : [];
  const shipClosed = shipment?.shipmentStatus === 'delivered' || shipment?.shipmentStatus === 'failed';

  return (
    <div className="space-y-5">
      {msg && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${msg.kind === 'ok' ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/5 text-destructive'}`}>
          {msg.text}
        </p>
      )}

      {/* ── Order status ─────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Order status</h3>
        <Timeline
          steps={ORDER_FLOW as readonly string[]}
          current={orderStatus}
          labelFn={adminStatusLabel}
          className="mt-3"
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {next && orderEditable ? (
            <>
              <Button onClick={() => run('status', () => updateOrderStatus({ orderId, status: next }), `Moved to ${next}.`)} disabled={busy !== null || needsTracking}>
                {busy === 'status' ? <Loader2 className="animate-spin" /> : <ArrowRight />} Advance to {adminStatusLabel(next)}
              </Button>
              {needsTracking && <span className="text-xs text-muted-foreground">Save a tracking number + courier below first.</span>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No further fulfilment action ({adminStatusLabel(orderStatus)}).</p>
          )}
        </div>
      </section>

      {/* ── Shipping & tracking (single source of entry) ─────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Truck className="h-4 w-4" /> Shipping &amp; tracking
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="courier" className="text-xs">Courier</Label>
            <select
              id="courier"
              value={courier}
              onChange={(e) => setCourier(e.target.value as CourierName)}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-ring"
            >
              {COURIERS.map((c) => (
                <option key={c} value={c}>{courierLabel(c)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tracking" className="text-xs">Tracking number</Label>
            <Input id="tracking" value={tracking} onChange={(e) => setTrackingInput(e.target.value)} placeholder="Enter once" className="font-mono" />
          </div>
        </div>
        <Button variant="outline" size="sm" className="mt-3" disabled={busy !== null || tracking.trim().length < 3 || !courier} onClick={saveTracking}>
          {busy === 'track' ? <Loader2 className="animate-spin" /> : <Truck />} Save tracking
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Saved once — applied to both the order and the courier shipment.
        </p>
      </section>

      {/* ── Shipment progress ────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Shipment progress</h3>
          {shipment && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shipmentStatusChip(shipment.shipmentStatus)}`}>
              {shipmentStatusLabel(shipment.shipmentStatus)}
            </span>
          )}
        </div>

        {!shipment ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No shipment yet — save a courier + tracking number above to create one.
          </p>
        ) : (
          <>
            <Timeline steps={SHIP_FLOW} current={shipment.shipmentStatus} labelFn={(s) => shipmentStatusLabel(s as ShipmentStatus)} className="mt-3" />

            <dl className="mt-4 space-y-1 text-sm">
              <Row label="Courier" value={courierLabel(shipment.courier)} />
              <Row label="Tracking" value={shipment.trackingNumber ? <span className="font-mono text-xs text-amber-700">{shipment.trackingNumber}</span> : '—'} />
              <Row label="Ref" value={shipment.externalReference ? <span className="font-mono text-xs text-muted-foreground">{shipment.externalReference}</span> : '—'} />
            </dl>

            {shipNext.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {shipNext.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => run(`ship-${s}`, () => setShipmentStatus({ shipmentId: shipment.id, status: s }), `Shipment: ${shipmentStatusLabel(s)}.`)}
                    disabled={busy !== null}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                      s === 'delivered' ? 'bg-success/15 text-success hover:bg-success/25' : s === 'failed' ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'border hover:bg-muted'
                    }`}
                  >
                    {busy === `ship-${s}` ? <Loader2 className="h-4 w-4 animate-spin" /> : shipIcon(s)}
                    {s === 'picked_up' ? 'Mark dispatched' : shipmentStatusLabel(s)}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => run('sync', () => syncTracking({ shipmentId: shipment.id }), 'Shipment synced.')}
                disabled={busy !== null}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync shipment
              </button>
              {!shipClosed && (
                <button
                  type="button"
                  onClick={() => run('cancel', () => cancelShipment({ shipmentId: shipment.id }), 'Shipment cancelled.')}
                  disabled={busy !== null}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {busy === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel shipment
                </button>
              )}
            </div>

            {/* Tracking history (append-only shipment events). */}
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tracking history</p>
              {shipment.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {shipment.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 last:border-0">
                      <span className="font-medium">{shipmentStatusLabel(e.eventType.replace('shipment_created', 'created'))}</span>
                      {e.description && <span className="text-muted-foreground">{e.description}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(e.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Shipment status tracks the courier and is independent of the order’s fulfilment status above.
        </p>
      </section>
    </div>
  );
}

function shipIcon(s: ShipmentStatus) {
  if (s === 'delivered') return <PackageCheck className="h-4 w-4" />;
  if (s === 'failed') return <XCircle className="h-4 w-4" />;
  return <Truck className="h-4 w-4" />;
}

/** Compact horizontal step timeline. Off-flow states (cancelled/failed) render as a lone chip. */
function Timeline({ steps, current, labelFn, className = '' }: { steps: readonly string[]; current: string; labelFn: (s: string) => string; className?: string }) {
  const idx = steps.indexOf(current);
  if (idx === -1) {
    return (
      <div className={className}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
          <Circle className="h-3 w-3" /> {labelFn(current)}
        </span>
      </div>
    );
  }
  return (
    <ol className={`flex flex-wrap items-center gap-x-1 gap-y-2 ${className}`}>
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                active ? 'bg-primary text-primary-foreground' : done ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <Check className="h-3 w-3" /> : active ? <Circle className="h-3 w-3 fill-current" /> : <Circle className="h-3 w-3" />}
              {labelFn(s)}
            </span>
            {i < steps.length - 1 && <span className={`h-px w-3 ${done ? 'bg-success/40' : 'bg-border'}`} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
