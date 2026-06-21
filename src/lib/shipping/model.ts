// Shipment shared vocabulary — pure constants + presentational maps + the bounded shipment
// state machine. Safe in both client and server components. No I/O. Values are the lowercase
// DB enums (0033). This is SUPPLEMENTAL to orders.status (which is unchanged) — these are the
// courier-side states only.

export const SHIPMENT_STATUSES = [
  'created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const COURIERS = ['shiprocket', 'delhivery', 'bluedart', 'dtdc', 'other'] as const;
export type CourierName = (typeof COURIERS)[number];

export const COURIER_LABEL: Record<CourierName, string> = {
  shiprocket: 'Shiprocket',
  delhivery: 'Delhivery',
  bluedart: 'Blue Dart',
  dtdc: 'DTDC',
  other: 'Other',
};

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  created: 'Created',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed: 'Failed',
};

// Status → tailwind chip classes (admin tool palette + customer card).
export const SHIPMENT_STATUS_CHIP: Record<ShipmentStatus, string> = {
  created: 'bg-muted text-muted-foreground',
  picked_up: 'bg-blue-500/10 text-blue-600',
  in_transit: 'bg-indigo-500/10 text-indigo-600',
  out_for_delivery: 'bg-violet-500/10 text-violet-600',
  delivered: 'bg-success/12 text-success',
  failed: 'bg-destructive/10 text-destructive',
};

// The customer-facing happy path (failed is shown as a terminal off-ramp).
export const SHIPMENT_PROGRESS_STEPS: ShipmentStatus[] = [
  'created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

/**
 * Bounded shipment state machine — forward through the happy path; `failed` is reachable
 * from any non-terminal state; `delivered`/`failed` are terminal. This is the COURIER
 * status only — it never gates or mirrors orders.status.
 */
export const ALLOWED_SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  created: ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed'],
  picked_up: ['in_transit', 'out_for_delivery', 'delivered', 'failed'],
  in_transit: ['out_for_delivery', 'delivered', 'failed'],
  out_for_delivery: ['delivered', 'failed'],
  delivered: [],
  failed: [],
};

export const isShipmentStatus = (v: string): v is ShipmentStatus =>
  (SHIPMENT_STATUSES as readonly string[]).includes(v);
export const isCourier = (v: string): v is CourierName => (COURIERS as readonly string[]).includes(v);

export const courierLabel = (v: string): string => COURIER_LABEL[v as CourierName] ?? v;
export const shipmentStatusLabel = (v: string): string => SHIPMENT_STATUS_LABEL[v as ShipmentStatus] ?? v;
export const shipmentStatusChip = (v: string): string =>
  SHIPMENT_STATUS_CHIP[v as ShipmentStatus] ?? 'bg-muted text-muted-foreground';
export const allowedNextShipmentStatuses = (v: string): ShipmentStatus[] =>
  ALLOWED_SHIPMENT_TRANSITIONS[v as ShipmentStatus] ?? [];

/** Maps a shipment status to its audit action (Phase 8 vocabulary). */
export const SHIPMENT_STATUS_AUDIT: Record<ShipmentStatus, string> = {
  created: 'shipment.created',
  picked_up: 'shipment.dispatched',
  in_transit: 'shipment.updated',
  out_for_delivery: 'shipment.updated',
  delivered: 'shipment.delivered',
  failed: 'shipment.failed',
};
