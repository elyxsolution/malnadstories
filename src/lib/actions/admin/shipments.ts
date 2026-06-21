'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireShippingCapability } from '@/lib/shipping/access';
import { getCourierProvider } from '@/lib/shipping/courier';
import {
  allowedNextShipmentStatuses,
  SHIPMENT_STATUS_AUDIT,
  shipmentStatusLabel,
  type CourierName,
  type ShipmentStatus,
} from '@/lib/shipping/model';
import {
  ShipmentCreateSchema,
  ShipmentUpdateSchema,
  ShipmentStatusSchema,
  ShipmentIdSchema,
} from '@/lib/validations';

export type ShipmentActionResult = { ok: true; id: string } | { ok: false; error: string };
export type ShipmentSimpleResult = { ok: true } | { ok: false; error: string };

/**
 * Admin-only shipment management. Mirrors the cover_templates pattern: authorization via
 * requireShippingCapability (the future-RBAC seam), service-role writes (no client write
 * grant), audit via log_audit (entity_type 'shipment'). SUPPLEMENTAL — these actions NEVER
 * write orders.status / payments / webhooks; admins advance the order via the existing
 * Fulfilment control. Couriers are reached ONLY through the CourierProvider abstraction.
 */

type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, actorId: string, action: string, id: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: actorId,
    p_actor_type: 'admin',
    p_action: action,
    p_entity_type: 'shipment',
    p_entity_id: id,
    p_metadata: metadata,
  });

const addEvent = (svc: Svc, shipmentId: string, eventType: string, description: string) =>
  svc.from('shipment_events').insert({ shipment_id: shipmentId, event_type: eventType, description });

/** Create the shipment for an order via the courier provider (Mock today). One per order. */
export async function createShipment(input: unknown): Promise<ShipmentActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireShippingCapability('shipping:create');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ShipmentCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { orderId, courier, trackingNumber } = parsed.data;

  const svc = createServiceClient();

  // Verify the order exists (service-role; admins act across all orders).
  const { data: order } = await svc.from('orders').select('id').eq('id', orderId).maybeSingle();
  if (!order) return { ok: false, error: 'Order not found.' };

  // Talk to the courier strictly through the abstraction.
  let provided: { externalReference: string; trackingNumber?: string | null; labelUrl?: string | null };
  try {
    provided = await getCourierProvider(courier as CourierName).createShipment({ orderId, courier: courier as CourierName, trackingNumber });
  } catch (e) {
    console.error('[admin] createShipment provider error', e);
    return { ok: false, error: 'The courier could not create the shipment. Try again.' };
  }

  const { data, error } = await svc
    .from('shipments')
    .insert({
      order_id: orderId,
      courier,
      tracking_number: provided.trackingNumber ?? trackingNumber ?? null,
      shipment_status: 'created',
      label_url: provided.labelUrl ?? null,
      external_reference: provided.externalReference,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return { ok: false, error: 'This order already has a shipment.' };
    }
    console.error('[admin] createShipment insert error', error);
    return { ok: false, error: 'Could not create the shipment.' };
  }
  const id = (data as { id: string }).id;

  await addEvent(svc, id, 'shipment_created', `Shipment created with ${courier}.`);
  await audit(svc, actor.userId, 'shipment.created', id, { order_id: orderId, courier, external_reference: provided.externalReference });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/shipping');
  return { ok: true, id };
}

/** Assign courier / add or change the tracking number (audited). */
export async function updateShipment(input: unknown): Promise<ShipmentSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireShippingCapability('shipping:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ShipmentUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { shipmentId, courier, trackingNumber } = parsed.data;
  if (!courier && !trackingNumber) return { ok: false, error: 'Nothing to update.' };

  const svc = createServiceClient();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.userId };
  if (courier) fields.courier = courier;
  if (trackingNumber) fields.tracking_number = trackingNumber;

  const { data, error } = await svc.from('shipments').update(fields).eq('id', shipmentId).select('order_id').maybeSingle();
  if (error || !data) {
    console.error('[admin] updateShipment error', error);
    return { ok: false, error: 'Could not update the shipment.' };
  }

  await audit(svc, actor.userId, 'shipment.updated', shipmentId, {
    ...(courier ? { courier } : {}),
    ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
  });
  revalidatePath(`/admin/orders/${(data as { order_id: string }).order_id}`);
  revalidatePath('/admin/shipping');
  return { ok: true };
}

/** Advance the courier-side shipment status (bounded state machine) + append an event. */
export async function setShipmentStatus(input: unknown): Promise<ShipmentSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireShippingCapability('shipping:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ShipmentStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { shipmentId, status } = parsed.data;

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from('shipments')
    .select('order_id, shipment_status')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Shipment not found.' };
  const cur = existing as { order_id: string; shipment_status: string };

  if (!allowedNextShipmentStatuses(cur.shipment_status).includes(status as ShipmentStatus)) {
    return { ok: false, error: `Cannot move a ${shipmentStatusLabel(cur.shipment_status)} shipment to ${shipmentStatusLabel(status)}.` };
  }

  const { error } = await svc
    .from('shipments')
    .update({ shipment_status: status, updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', shipmentId);
  if (error) {
    console.error('[admin] setShipmentStatus error', error);
    return { ok: false, error: 'Could not update the shipment status.' };
  }

  await addEvent(svc, shipmentId, status, `Status set to ${shipmentStatusLabel(status)}.`);
  await audit(svc, actor.userId, SHIPMENT_STATUS_AUDIT[status as ShipmentStatus] ?? 'shipment.updated', shipmentId, {
    order_id: cur.order_id,
    from: cur.shipment_status,
    to: status,
  });

  revalidatePath(`/admin/orders/${cur.order_id}`);
  revalidatePath('/admin/shipping');
  return { ok: true };
}

/** Cancel a shipment via the provider → mark failed (terminal). Audited. */
export async function cancelShipment(input: unknown): Promise<ShipmentSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireShippingCapability('shipping:cancel');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ShipmentIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { shipmentId } = parsed.data;

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from('shipments')
    .select('order_id, shipment_status, courier, external_reference')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Shipment not found.' };
  const s = existing as { order_id: string; shipment_status: string; courier: string; external_reference: string | null };
  if (s.shipment_status === 'delivered' || s.shipment_status === 'failed') {
    return { ok: false, error: 'This shipment is already closed.' };
  }

  if (s.external_reference) {
    try {
      await getCourierProvider(s.courier as CourierName).cancelShipment(s.external_reference);
    } catch (e) {
      console.error('[admin] cancelShipment provider error — continuing to mark failed', e);
    }
  }

  const { error } = await svc
    .from('shipments')
    .update({ shipment_status: 'failed', updated_at: new Date().toISOString(), updated_by: actor.userId })
    .eq('id', shipmentId);
  if (error) {
    console.error('[admin] cancelShipment error', error);
    return { ok: false, error: 'Could not cancel the shipment.' };
  }

  await addEvent(svc, shipmentId, 'failed', 'Cancelled by admin.');
  await audit(svc, actor.userId, 'shipment.failed', shipmentId, { order_id: s.order_id, reason: 'cancelled' });

  revalidatePath(`/admin/orders/${s.order_id}`);
  revalidatePath('/admin/shipping');
  return { ok: true };
}

/**
 * Pull the latest tracking from the courier (provider abstraction) and append any NEW events.
 * Webhook-ready: a real courier webhook would do the same append keyed on external_reference.
 * With the Mock provider this is effectively a no-op refresh.
 */
export async function syncTracking(input: unknown): Promise<ShipmentSimpleResult> {
  let actor: { userId: string };
  try {
    actor = await requireShippingCapability('shipping:update');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = ShipmentIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { shipmentId } = parsed.data;

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from('shipments')
    .select('order_id, courier, external_reference')
    .eq('id', shipmentId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Shipment not found.' };
  const s = existing as { order_id: string; courier: string; external_reference: string | null };
  if (!s.external_reference) return { ok: false, error: 'No courier reference to sync.' };

  try {
    const tracking = await getCourierProvider(s.courier as CourierName).getTracking(s.external_reference);
    // A live provider returns real scans here; we'd reconcile + append. The Mock returns the
    // registration event only, so there is nothing new to add — kept as the integration seam.
    void tracking;
  } catch (e) {
    console.error('[admin] syncTracking provider error', e);
    return { ok: false, error: 'Could not reach the courier for tracking.' };
  }

  await audit(svc, actor.userId, 'shipment.updated', shipmentId, { order_id: s.order_id, action: 'sync' });
  revalidatePath(`/admin/orders/${s.order_id}`);
  return { ok: true };
}
