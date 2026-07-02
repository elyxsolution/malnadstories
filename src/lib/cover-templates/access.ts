import 'server-only';
import { requireCapability } from '@/lib/auth/require-admin';

/**
 * Cover-template capability gate — the SINGLE authorization choke point for every cover-design
 * template mutation. Backed by RBAC (Phase 9G): delegates to requireCapability('cover:manage'),
 * so only roles holding it (content / super_admin) pass — the SAME capability that already gates
 * the legacy PNG cover catalog (/admin/covers). Never call requireAdmin() directly from a
 * cover-template action; always go through this.
 */
export async function requireCoverTemplateCapability() {
  return requireCapability('cover:manage');
}
