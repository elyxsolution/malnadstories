/**
 * RBAC capability model (Phase 9G) — pure constants + lookups, safe in Server and Client
 * Components (no I/O). Capabilities, NOT roles, are the enforcement unit: every gate checks a
 * capability, and roles are just fixed bundles of capabilities. The server is the only place
 * a role is ever resolved (from admin_roles, behind the profiles.role='admin' gate) — nothing
 * here trusts client input.
 */

export const ADMIN_ROLES = ['super_admin', 'production', 'support', 'content'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  production: 'Production',
  support: 'Support',
  content: 'Content',
};

// Every capability in the back-office. Domain:action. The existing seam strings (cms:*,
// template:edit/publish/archive, shipping:create/update/cancel) are kept verbatim so no
// migrated call site changes meaning.
export const CAPABILITIES = [
  'order:view', 'order:update', 'order:note',
  'album:view', 'album:manage',
  'shipping:view', 'shipping:create', 'shipping:update', 'shipping:cancel',
  'review:view', 'review:update',
  'support:view', 'support:reply', 'support:manage',
  'refund:view', 'refund:update',
  'reprint:view', 'reprint:update',
  'customer:view',
  'cms:edit', 'cms:publish', 'cms:archive',
  'template:edit', 'template:publish', 'template:archive',
  'cover:manage',
  'sticker:manage',
  'coupon:manage',
  'analytics:view',
  'system:view',
  'monitoring:view', 'monitoring:manage',
  'observability:view', 'observability:manage',
  'security:view', 'security:manage',
  'storage:view', 'storage:manage',
  'role:manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Role → capability bundles. super_admin is a wildcard (handled in roleHasCapability).
const PRODUCTION: Capability[] = [
  'order:view', 'order:update', 'order:note',
  'album:view', 'album:manage',
  'shipping:view', 'shipping:create', 'shipping:update', 'shipping:cancel',
  'review:view', 'review:update',
  'analytics:view',
  'monitoring:view',
  'observability:view',
  'security:view',
  'storage:view', 'storage:manage',
];
const SUPPORT: Capability[] = [
  'support:view', 'support:reply', 'support:manage',
  'refund:view', 'refund:update',
  'reprint:view', 'reprint:update',
  'customer:view',
  'order:view',
  'monitoring:view',
  'observability:view',
  'security:view',
];
const CONTENT: Capability[] = [
  'cms:edit', 'cms:publish', 'cms:archive',
  'template:edit', 'template:publish', 'template:archive',
  'cover:manage',
  'sticker:manage',
];

export const ROLE_CAPABILITIES: Record<AdminRole, Capability[]> = {
  super_admin: [...CAPABILITIES], // wildcard (see roleHasCapability)
  production: PRODUCTION,
  support: SUPPORT,
  content: CONTENT,
};

export const isAdminRole = (v: string): v is AdminRole => (ADMIN_ROLES as readonly string[]).includes(v);
export const roleLabel = (v: string): string => ROLE_LABEL[v as AdminRole] ?? v;

/** THE authorization predicate. super_admin can do anything; others by explicit bundle. */
export function roleHasCapability(role: AdminRole, capability: Capability): boolean {
  if (role === 'super_admin') return true;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/**
 * Admin route → required capability (longest-prefix match). Used by the layout route-guard
 * (before render) AND the nav allow-list. `/admin` (the dashboard) needs none — any admin.
 * Order longest-first so nested prefixes win.
 */
const ROUTE_CAPABILITY: { prefix: string; capability: Capability }[] = [
  { prefix: '/admin/orders', capability: 'order:view' },
  { prefix: '/admin/production', capability: 'order:view' },
  { prefix: '/admin/shipping', capability: 'shipping:view' },
  { prefix: '/admin/reviews', capability: 'review:view' },
  { prefix: '/admin/support', capability: 'support:view' },
  { prefix: '/admin/refunds', capability: 'refund:view' },
  { prefix: '/admin/reprints', capability: 'reprint:view' },
  { prefix: '/admin/customers', capability: 'customer:view' },
  { prefix: '/admin/albums', capability: 'album:view' },
  { prefix: '/admin/covers', capability: 'cover:manage' },
  { prefix: '/admin/stickers', capability: 'sticker:manage' },
  { prefix: '/admin/coupons', capability: 'coupon:manage' },
  { prefix: '/admin/cms', capability: 'cms:edit' },
  { prefix: '/admin/templates', capability: 'template:edit' },
  { prefix: '/admin/analytics', capability: 'analytics:view' },
  { prefix: '/admin/monitoring', capability: 'monitoring:view' },
  { prefix: '/admin/errors', capability: 'observability:view' },
  { prefix: '/admin/security', capability: 'security:view' },
  { prefix: '/admin/storage', capability: 'storage:view' },
  { prefix: '/admin/system', capability: 'system:view' },
  { prefix: '/admin/users', capability: 'role:manage' },
  { prefix: '/admin/settings', capability: 'system:view' },
];
// Longest prefix first so nested routes match their most specific guard.
ROUTE_CAPABILITY.sort((a, b) => b.prefix.length - a.prefix.length);

/** The capability a path requires, or null for an unguarded admin route (e.g. the dashboard). */
export function routeCapability(pathname: string | null | undefined): Capability | null {
  if (!pathname) return null;
  const match = ROUTE_CAPABILITY.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return match?.capability ?? null;
}

/** Top-level nav hrefs this role may see (server-computed allow-list — the nav never decides). */
export function navHrefsForRole(role: AdminRole): string[] {
  const allowed = ['/admin']; // dashboard: any admin
  for (const r of ROUTE_CAPABILITY) {
    if (roleHasCapability(role, r.capability) && !allowed.includes(r.prefix)) allowed.push(r.prefix);
  }
  return allowed;
}
