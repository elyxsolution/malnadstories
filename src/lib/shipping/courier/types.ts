import type { CourierName, ShipmentStatus } from '../model';

/**
 * Courier provider abstraction (Phase 9F). The app talks to couriers ONLY through this
 * interface so a real integration (Shiprocket / Delhivery / Blue Dart / DTDC) can be dropped
 * in later behind the registry with no call-site changes. Today only MockCourierProvider
 * exists (no live network calls). All methods are async + side-effect-free toward our DB —
 * persistence stays in the server actions.
 */

export type CreateShipmentInput = {
  orderId: string;
  courier: CourierName;
  trackingNumber?: string | null;
  // Minimal destination context a real provider would need (kept loose — mock ignores it).
  toName?: string | null;
  toCity?: string | null;
  toPincode?: string | null;
};

export type CreateShipmentResult = {
  externalReference: string;
  trackingNumber?: string | null;
  labelUrl?: string | null;
};

export type TrackingEvent = {
  type: ShipmentStatus | 'shipment_created';
  description?: string;
  occurredAt: string; // ISO
};

export type TrackingResult = {
  status: ShipmentStatus;
  events: TrackingEvent[];
};

export type CancelResult = { ok: boolean };

export interface CourierProvider {
  readonly name: CourierName;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  getTracking(externalReference: string): Promise<TrackingResult>;
  cancelShipment(externalReference: string): Promise<CancelResult>;
}
