'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { ADMIN_ROLES } from '@/lib/auth/capabilities';

export type RoleActionResult = { ok: true } | { ok: false; error: string };

const AssignRoleSchema = z.object({
  userId: z.string().uuid('Invalid user'),
  role: z.enum(ADMIN_ROLES),
});

/**
 * Assign a fixed back-office role to an existing admin (Phase 9G). super_admin only
 * (role:manage). Hardened against escalation + lockout:
 *   • Only an existing admin (profiles.role='admin') can receive a role — never a customer.
 *   • You cannot change your OWN role (prevents a sole super_admin self-demoting into lockout;
 *     another super_admin must do it).
 *   • Roles are validated against the fixed set; nothing is trusted from the client beyond
 *     the target user id + the chosen role (both re-checked here).
 * Writes via the service role (admin_roles has no client write grant) and audits the change.
 */
export async function assignRole(input: unknown): Promise<RoleActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('role:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = AssignRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { userId, role } = parsed.data;

  if (userId === actor.userId) {
    return { ok: false, error: 'You cannot change your own role — ask another super admin.' };
  }

  // The target must already be an admin (RBAC scopes admins; it never grants admin access).
  const [target] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!target || target.role !== 'admin') {
    return { ok: false, error: 'That user is not an admin.' };
  }

  const svc = createServiceClient();

  // Detect create vs change for the audit action.
  const { data: existing } = await svc.from('admin_roles').select('role').eq('user_id', userId).maybeSingle();
  const prior = (existing as { role: string } | null)?.role ?? null;

  const { error } = await svc
    .from('admin_roles')
    .upsert({ user_id: userId, role, assigned_by: actor.userId, assigned_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    console.error('[admin] assignRole upsert error', error);
    return { ok: false, error: 'Could not assign the role.' };
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: prior ? 'role.changed' : 'role.assigned',
    p_entity_type: 'admin_role',
    p_entity_id: userId,
    p_metadata: { role, ...(prior ? { from: prior } : {}) },
  });

  revalidatePath('/admin/users');
  return { ok: true };
}
