'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { runHealthChecksNow } from '@/lib/monitoring/engine';

export type MonitoringActionResult = { ok: true } | { ok: false; error: string };

/**
 * Force a fresh health check + persist (bypasses the read-time throttle). monitoring:manage.
 * Read-only over existing tables; writes only to the monitoring tables + audit.
 */
export async function runHealthChecks(): Promise<MonitoringActionResult> {
  try {
    await requireCapability('monitoring:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  await runHealthChecksNow();
  revalidatePath('/admin/monitoring');
  return { ok: true };
}

/** Manually resolve an alert (marks resolved — never deletes/overwrites). monitoring:manage. */
export async function resolveAlert(input: unknown): Promise<MonitoringActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('monitoring:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = z.object({ id: z.string().uuid('Invalid alert') }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('system_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('resolved', false)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[admin] resolveAlert error', error);
    return { ok: false, error: 'Could not resolve the alert.' };
  }
  if (!data) return { ok: false, error: 'Alert not found or already resolved.' };

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'alert.resolved',
    p_entity_type: 'system_alert',
    p_entity_id: id,
    p_metadata: { reason: 'manual' },
  });

  revalidatePath('/admin/monitoring');
  return { ok: true };
}
