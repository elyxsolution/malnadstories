import 'server-only';
import { randomUUID } from 'crypto';
import type { CourierName } from '../model';
import type {
  CourierProvider,
  CreateShipmentInput,
  CreateShipmentResult,
  TrackingResult,
  CancelResult,
} from './types';

/**
 * MockCourierProvider — a deterministic, network-free stand-in for a real courier API.
 * It lets the whole shipment workflow run end to end (create → track → cancel) without any
 * external dependency. A real provider implements the SAME CourierProvider interface and is
 * swapped in via the registry (`./index`) — no call-site or DB changes.
 *
 * getTracking() returns a single "created" event; in the mock world the authoritative state
 * is whatever the admin set in our DB, so syncTracking is effectively a no-op refresh. A
 * live provider would return the courier's real scan history here (and a webhook would push
 * it), which is why the data model already stores external_reference + an append-only log.
 */
export class MockCourierProvider implements CourierProvider {
  readonly name: CourierName;

  constructor(name: CourierName = 'other') {
    this.name = name;
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const ref = `MOCK-${this.name}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const tracking = input.trackingNumber?.trim() || `MK${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    return { externalReference: ref, trackingNumber: tracking, labelUrl: null };
  }

  async getTracking(externalReference: string): Promise<TrackingResult> {
    return {
      status: 'created',
      events: [
        { type: 'shipment_created', description: `Mock shipment ${externalReference} registered.`, occurredAt: new Date().toISOString() },
      ],
    };
  }

  async cancelShipment(_externalReference: string): Promise<CancelResult> {
    void _externalReference;
    return { ok: true };
  }
}
