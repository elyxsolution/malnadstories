import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

/**
 * Security audit trail (Phase 10C).
 *
 * Thin wrapper over the existing append-only `audit_log` + `log_audit()` RPC (0016),
 * so security events live in the SAME immutable trail as everything else (admin-read,
 * service-write, no update/delete). Best-effort + never-throws: a failed audit must
 * never break the request it is observing. entity_type is always 'security'.
 *
 * `audit_log.entity_id` is NOT NULL; for pre-auth / IP-only events (e.g. a blocked
 * login attempt) there is no user, so a nil-uuid sentinel is used as the subject.
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export type SecurityAction =
  | 'security.rate_limit'
  | 'security.access_denied'
  | 'security.violation';

export type SecurityActor = {
  /** Present when the observed surface is authenticated. */
  userId?: string | null;
  /** Defaults to 'customer' when a userId is given, else 'system' (pre-auth/IP). */
  actorType?: 'customer' | 'system';
};

export async function logSecurity(
  action: SecurityAction,
  metadata: Record<string, unknown>,
  actor: SecurityActor = {},
): Promise<void> {
  try {
    const svc = createServiceClient();
    await svc.rpc('log_audit', {
      p_actor_id: actor.userId ?? null,
      p_actor_type: actor.actorType ?? (actor.userId ? 'customer' : 'system'),
      p_action: action,
      p_entity_type: 'security',
      p_entity_id: actor.userId ?? NIL_UUID,
      p_metadata: metadata,
    });
  } catch (e) {
    console.error('[security] audit failed — continuing', String(e));
  }
}
