import 'server-only';
import { requireCapability, type AdminContext } from '@/lib/auth/require-admin';

/**
 * RBAC seam for the Album Product ("Dimensions") admin section (0047). Mirrors the
 * cms/template/shipping capability seams — every product mutation goes through here so the
 * capability check is the authoritative boundary (service-role writes still pass through it).
 */
export function requireProductCapability(): Promise<AdminContext> {
  return requireCapability('product:manage');
}
