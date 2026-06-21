import { Truck, Check, Circle, XCircle } from 'lucide-react';
import {
  courierLabel,
  shipmentStatusLabel,
  shipmentStatusChip,
  SHIPMENT_PROGRESS_STEPS,
  type ShipmentStatus,
} from '@/lib/shipping/model';

export type CustomerShipment = {
  courier: string;
  trackingNumber: string | null;
  shipmentStatus: string;
};

/**
 * Read-only courier shipment card shown on the customer order page (Phase 9F) — an
 * ENHANCEMENT below the existing orders.status timeline, rendered only when a shipment
 * exists. Pure presentation; the data is RLS-scoped to the owner upstream.
 */
export default function ShipmentCard({ shipment }: { shipment: CustomerShipment }) {
  const failed = shipment.shipmentStatus === 'failed';
  const currentIdx = SHIPMENT_PROGRESS_STEPS.indexOf(shipment.shipmentStatus as ShipmentStatus);

  return (
    <section className="mt-4 rounded-2xl border bg-card p-6 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
          <Truck className="h-4 w-4 text-gold" /> Shipment
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${shipmentStatusChip(shipment.shipmentStatus)}`}>
          {shipmentStatusLabel(shipment.shipmentStatus)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Courier</dt>
          <dd className="font-medium">{courierLabel(shipment.courier)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Tracking number</dt>
          <dd className="font-mono text-[13px]">{shipment.trackingNumber ?? '—'}</dd>
        </div>
      </dl>

      {failed ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <XCircle className="h-4 w-4" /> There was an issue with this shipment — our team is on it.
        </p>
      ) : (
        <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {SHIPMENT_PROGRESS_STEPS.map((s, i) => {
            const done = currentIdx >= 0 && i <= currentIdx;
            const current = i === currentIdx;
            return (
              <li key={s} className="flex items-center gap-1.5 text-[13px]">
                {done ? (
                  <Check className={`h-4 w-4 ${current ? 'text-primary' : 'text-success'}`} />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
                <span className={done ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {shipmentStatusLabel(s)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
