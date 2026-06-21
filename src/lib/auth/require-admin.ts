import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { profiles, adminRoles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { roleHasCapability, type AdminRole, type Capability } from './capabilities';

/** Thrown when the caller is not an authenticated admin. */
export class NotAdminError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'NotAdminError';
  }
}

/** Thrown when an authenticated admin lacks the required capability (RBAC, Phase 9G). */
export class NotAuthorizedError extends Error {
  constructor(public readonly capability: Capability) {
    super('Forbidden');
    this.name = 'NotAuthorizedError';
  }
}

export type AdminContext = { userId: string; email: string | null; role: AdminRole };

/**
 * THE backend source of truth for admin authorization + RBAC role resolution.
 *
 * 1. Validates the JWT with getUser() (not getSession()).
 * 2. Confirms profiles.role='admin' via the Drizzle superuser (RLS-independent, ungameable;
 *    profiles.role itself is locked against self-promotion by migration 0019). Non-admins
 *    throw NotAdminError — exactly as before RBAC.
 * 3. Resolves the fine-grained back-office role from admin_roles. MIGRATION SAFETY: an admin
 *    with NO admin_roles row is treated as 'super_admin', so existing operators keep full
 *    access with no backfill and no lockout.
 *
 * Wrapped in React cache(): within ONE server render the layout + page + any nested gate share
 * a single getUser() + profile/role lookup. Per-request only — every request re-validates.
 */
export const getAdminContext = cache(async (): Promise<AdminContext> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAdminError('Not signed in');

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  if (!profile || profile.role !== 'admin') throw new NotAdminError('Forbidden');

  const [roleRow] = await db
    .select({ role: adminRoles.role })
    .from(adminRoles)
    .where(eq(adminRoles.userId, user.id))
    .limit(1);

  // Absent row → super_admin (migration safety). Unknown value falls back to super_admin too
  // (fail-open ONLY for an already-verified admin — never for a non-admin).
  const role = (roleRow?.role as AdminRole | undefined) ?? 'super_admin';

  return { userId: user.id, email: user.email ?? null, role };
});

/**
 * Base admin gate (back-compat). Returns the full AdminContext (superset of the old
 * {userId,email} — existing destructures keep working). Throws NotAdminError if not a
 * signed-in admin. Use this where any admin is allowed (e.g. the dashboard).
 */
export async function requireAdmin(): Promise<AdminContext> {
  return getAdminContext();
}

/**
 * Capability gate — the authoritative RBAC check. Resolves the admin context, then requires
 * `capability`. On denial it records an immutable `access.denied` audit row and throws
 * NotAuthorizedError (server actions already catch this and return Forbidden). Call this at
 * the top of EVERY admin action — service-role writes must still pass through here.
 */
export async function requireCapability(capability: Capability): Promise<AdminContext> {
  const ctx = await getAdminContext(); // throws NotAdminError if not an admin
  if (!roleHasCapability(ctx.role, capability)) {
    await auditAccessDenied(ctx.userId, capability);
    throw new NotAuthorizedError(capability);
  }
  return ctx;
}

/** Best-effort, never-throwing access.denied audit (service role; log_audit is 0016). */
export async function auditAccessDenied(
  userId: string | null,
  capability: Capability,
  path?: string,
): Promise<void> {
  try {
    const { createServiceClient } = await import('@/lib/supabase/service');
    await createServiceClient().rpc('log_audit', {
      p_actor_id: userId,
      p_actor_type: 'admin',
      p_action: 'access.denied',
      p_entity_type: 'access',
      p_entity_id: userId, // entity_id is NOT NULL; the actor is the meaningful subject here
      p_metadata: { capability, ...(path ? { path } : {}) },
    });
  } catch (e) {
    console.error('[rbac] access.denied audit failed — continuing', String(e));
  }
}
