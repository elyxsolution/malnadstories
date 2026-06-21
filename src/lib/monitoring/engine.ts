import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { collectHealth } from './collectors';
import { worstHealth, type AlertSpec, type ServiceHealth, type HealthStatus } from './model';

/**
 * Monitoring engine (Phase 10A). Persists health snapshots + reconciles append-only alerts.
 *
 * PULL + THROTTLED: nothing runs in the background. `persistIfStale` runs only when an admin
 * opens the monitoring surface AND the last snapshot is older than CHECK_TTL_MS — so many page
 * loads (or many admins) never cause more than one run per window, and there is no polling loop
 * or per-render write bloat. Everything here is best-effort and NEVER throws: monitoring must
 * not be able to break a page. All writes go through the service role (admin-only tables).
 */

const CHECK_TTL_MS = 5 * 60 * 1000; // throttle: at most one persisted run per 5 minutes
// audit_log.entity_id is NOT NULL; use a stable sentinel for system-wide events (the run
// summary) that have no single entity. Alert events use the alert's own id.
const SYSTEM_ENTITY = '00000000-0000-0000-0000-000000000000';
type Svc = ReturnType<typeof createServiceClient>;

const audit = (svc: Svc, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) =>
  svc.rpc('log_audit', {
    p_actor_id: null, // system actor (the monitoring engine)
    p_actor_type: 'system',
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: metadata,
  });

/** Most recent snapshot time across all services, or null if none yet. */
async function lastCheckedAt(svc: Svc): Promise<Date | null> {
  const { data } = await svc
    .from('health_checks')
    .select('checked_at')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = (data as { checked_at: string } | null)?.checked_at;
  return v ? new Date(v) : null;
}

/** Insert one health_checks row per service + reconcile alerts + audit. Never throws. */
export async function persistRun(health: ServiceHealth[]): Promise<void> {
  try {
    const svc = createServiceClient();
    const now = new Date().toISOString();

    // 1) Snapshot history.
    await svc.from('health_checks').insert(
      health.map((h) => ({ service: h.service, status: h.status, message: h.message, checked_at: now })),
    );

    // 2) Reconcile alerts (idempotent via dedupe_key; cleared conditions auto-resolve).
    const breaches = new Map<string, AlertSpec>();
    for (const h of health) for (const a of h.alerts) breaches.set(a.dedupeKey, a);

    const { data: openRows } = await svc.from('system_alerts').select('id, dedupe_key').eq('resolved', false);
    const open = (openRows ?? []) as { id: string; dedupe_key: string }[];
    const openKeys = new Set(open.map((o) => o.dedupe_key));

    // Open new alerts.
    for (const [key, spec] of Array.from(breaches)) {
      if (openKeys.has(key)) continue;
      const { data: created, error } = await svc
        .from('system_alerts')
        .insert({ severity: spec.severity, source: spec.source, title: spec.title, message: spec.message, dedupe_key: key })
        .select('id')
        .maybeSingle();
      // 23505 = a concurrent run already opened this one → fine.
      if (error && (error as { code?: string }).code !== '23505') {
        console.error('[monitoring] alert insert error', error);
        continue;
      }
      const newId = (created as { id: string } | null)?.id;
      if (newId) await audit(svc, 'alert.created', 'system_alert', newId, { dedupe_key: key, severity: spec.severity, source: spec.source });
    }

    // Auto-resolve alerts whose condition has cleared.
    for (const o of open) {
      if (breaches.has(o.dedupe_key)) continue;
      await svc.from('system_alerts').update({ resolved: true, resolved_at: now }).eq('id', o.id).eq('resolved', false);
      await audit(svc, 'alert.resolved', 'system_alert', o.id, { dedupe_key: o.dedupe_key, reason: 'auto' });
    }

    // 3) One run summary in the audit trail.
    const overall = worstHealth(health.map((h) => h.status));
    await audit(svc, 'health.check', 'monitoring', SYSTEM_ENTITY, {
      overall,
      warnings: health.filter((h) => h.status === 'warning').length,
      criticals: health.filter((h) => h.status === 'critical').length,
    });
  } catch (e) {
    console.error('[monitoring] persistRun failed — continuing', String(e));
  }
}

/** Persist a run only if the last one is stale (throttle). Best-effort. */
export async function persistIfStale(health: ServiceHealth[]): Promise<void> {
  try {
    const svc = createServiceClient();
    const last = await lastCheckedAt(svc);
    if (last && Date.now() - last.getTime() < CHECK_TTL_MS) return; // fresh enough — skip
    await persistRun(health);
  } catch (e) {
    console.error('[monitoring] persistIfStale failed — continuing', String(e));
  }
}

/** Force a fresh collect + persist (the "Run checks now" admin action). */
export async function runHealthChecksNow(): Promise<ServiceHealth[]> {
  const health = await collectHealth();
  await persistRun(health);
  return health;
}

export type AlertRow = {
  id: string;
  severity: string;
  source: string;
  title: string;
  message: string | null;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

/** Recent alerts (newest first) for the live feed. */
export async function listRecentAlerts(limit = 50): Promise<AlertRow[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('system_alerts')
    .select('id, severity, source, title, message, resolved, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    severity: r.severity as string,
    source: r.source as string,
    title: r.title as string,
    message: (r.message as string | null) ?? null,
    resolved: r.resolved as boolean,
    createdAt: r.created_at as string,
    resolvedAt: (r.resolved_at as string | null) ?? null,
  }));
}

export type { ServiceHealth, HealthStatus };
