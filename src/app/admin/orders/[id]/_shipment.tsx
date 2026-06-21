'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Truck, PackageCheck, RefreshCw, XCircle, Plus } from 'lucide-react';
import {
  createShipment,
  updateShipment,
  setShipmentStatus,
  cancelShipment,
  syncTracking,
} from '@/lib/actions/admin/shipments';
import {
  COURIERS,
  courierLabel,
  shipmentStatusLabel,
  shipmentStatusChip,
  allowedNextShipmentStatuses,
  type CourierName,
  type ShipmentStatus,
} from '@/lib/shipping/model';
import { fmtDateTime } from '@/lib/admin/format';

export type ShipmentView = {
  id: string;
  courier: string;
  trackingNumber: string | null;
  shipmentStatus: string;
  externalReference: string | null;
  events: { id: string; eventType: string; description: string | null; occurredAt: string }[];
} | null;

/**
 * Per-order shipment management (Phase 9F). Supplemental to the order's fulfilment status —
 * nothing here changes orders.status. All writes go through the requireShippingCapability
 * server actions; couriers are reached only via the provider abstraction (Mock today).
 */
export default function ShipmentPanel({ orderId, shipment }: { orderId: string; shipment: ShipmentView }) {
  const router = useRouter();
  const [courier, setCourier] = useState<CourierName>('delhivery');
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setTracking('');
      router.refresh();
    } else {
      setMsg(res.error ?? 'Something went wrong.');
    }
  };

  // ── No shipment yet → create form ──
  if (!shipment) {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Truck className="h-4 w-4" /> Shipment
        </p>
        <p className="text-xs text-muted-foreground">No shipment yet. Create one to assign a courier and track dispatch.</p>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Courier</label>
          <select
            value={courier}
            onChange={(e) => setCourier(e.target.value as CourierName)}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-ring"
          >
            {COURIERS.map((c) => (
              <option key={c} value={c}>
                {courierLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tracking number (optional)</label>
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            placeholder="Auto-generated if blank"
            className="h-9 w-full rounded-md border bg-background px-2 font-mono text-sm outline-none focus:border-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => run('create', () => createShipment({ orderId, courier, trackingNumber: tracking.trim() || undefined }))}
          disabled={busy !== null}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create shipment
        </button>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
      </div>
    );
  }

  const next = allowedNextShipmentStatuses(shipment.shipmentStatus);
  const closed = shipment.shipmentStatus === 'delivered' || shipment.shipmentStatus === 'failed';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Truck className="h-4 w-4" /> Shipment
          </p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shipmentStatusChip(shipment.shipmentStatus)}`}>
            {shipmentStatusLabel(shipment.shipmentStatus)}
          </span>
        </div>
        <dl className="space-y-1 text-sm">
          <Row label="Courier" value={courierLabel(shipment.courier)} />
          <Row label="Tracking" value={shipment.trackingNumber ? <span className="font-mono text-xs text-amber-700">{shipment.trackingNumber}</span> : '—'} />
          <Row label="Ref" value={shipment.externalReference ? <span className="font-mono text-xs text-muted-foreground">{shipment.externalReference}</span> : '—'} />
        </dl>

        {/* Assign courier / add tracking */}
        {!closed && (
          <div className="mt-3 space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <select
                defaultValue={shipment.courier}
                onChange={(e) => run('courier', () => updateShipment({ shipmentId: shipment.id, courier: e.target.value as CourierName }))}
                disabled={busy !== null}
                className="h-8 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:border-ring"
              >
                {COURIERS.map((c) => (
                  <option key={c} value={c}>
                    {courierLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Add / change tracking #"
                className="h-8 flex-1 rounded-md border bg-background px-2 font-mono text-sm outline-none focus:border-ring"
              />
              <button
                type="button"
                onClick={() => run('tracking', () => updateShipment({ shipmentId: shipment.id, trackingNumber: tracking.trim() }))}
                disabled={busy !== null || tracking.trim().length < 3}
                className="h-8 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status transitions */}
      {next.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Update status</p>
          <div className="flex flex-col gap-1.5">
            {next.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => run(`status-${s}`, () => setShipmentStatus({ shipmentId: shipment.id, status: s }))}
                disabled={busy !== null}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                  s === 'delivered'
                    ? 'bg-success/15 text-success hover:bg-success/25'
                    : s === 'failed'
                      ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                      : 'border hover:bg-muted'
                }`}
              >
                {busy === `status-${s}` ? <Loader2 className="h-4 w-4 animate-spin" /> : statusIcon(s)}
                {s === 'picked_up' ? 'Mark dispatched (picked up)' : shipmentStatusLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run('sync', () => syncTracking({ shipmentId: shipment.id }))}
          disabled={busy !== null}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync
        </button>
        {!closed && (
          <button
            type="button"
            onClick={() => run('cancel', () => cancelShipment({ shipmentId: shipment.id }))}
            disabled={busy !== null}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {busy === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel
          </button>
        )}
      </div>

      {/* Event history */}
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</p>
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

      <p className="text-[11px] text-muted-foreground">
        Shipment status is independent of the order’s fulfilment status — advance the order above under Fulfilment.
      </p>
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}

function statusIcon(s: ShipmentStatus) {
  if (s === 'delivered') return <PackageCheck className="h-4 w-4" />;
  if (s === 'failed') return <XCircle className="h-4 w-4" />;
  return <Truck className="h-4 w-4" />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
