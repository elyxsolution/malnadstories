import 'server-only';
import { requireCapability } from '@/lib/auth/require-admin';

/**
 * CMS capability gate — the SINGLE authorization choke point for every CMS mutation.
 * Now backed by RBAC (Phase 9G): delegates to requireCapability, so only roles holding the
 * given CMS capability (content / super_admin) pass. Never call requireAdmin() directly from
 * a CMS action; always go through this.
 */
export type CmsCapability = 'cms:edit' | 'cms:publish' | 'cms:archive';

export async function requireCmsCapability(capability: CmsCapability) {
  return requireCapability(capability);
}
