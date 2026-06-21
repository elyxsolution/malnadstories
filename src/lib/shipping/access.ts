import 'server-only';
import { requireCapability } from '@/lib/auth/require-admin';

/**
 * Shipping capability gate — the SINGLE authorization choke point for every shipment
 * mutation. Now backed by RBAC (Phase 9G): delegates to requireCapability, so only roles
 * holding the given shipping capability (production / super_admin) pass. Never call
 * requireAdmin() directly from a shipment action; always go through this.
 */
export type ShippingCapability = 'shipping:create' | 'shipping:update' | 'shipping:cancel';

export async function requireShippingCapability(capability: ShippingCapability) {
  return requireCapability(capability);
}
