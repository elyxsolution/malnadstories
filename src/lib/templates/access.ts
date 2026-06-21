import 'server-only';
import { requireCapability } from '@/lib/auth/require-admin';

/**
 * Template capability gate — the SINGLE authorization choke point for every template
 * mutation. Now backed by RBAC (Phase 9G): delegates to requireCapability, so only roles
 * holding the given template capability (content / super_admin) pass. Never call
 * requireAdmin() directly from a template action; always go through this.
 */
export type TemplateCapability = 'template:edit' | 'template:publish' | 'template:archive';

export async function requireTemplateCapability(capability: TemplateCapability) {
  return requireCapability(capability);
}
