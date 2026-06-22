'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';

export type ObservabilityActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve a captured error (Phase 10B). Marks the error_events row resolved (append-only — never
 * deletes/edits the payload), resolves any linked critical system_alert (dedupe_key
 * 'error:<fingerprint>') so the monitoring feed stays in sync, and audits 'error.resolved'.
 * observability:manage. Mirrors monitoring's resolveAlert.
 */
export async function resolveError(input: unknown): Promise<ObservabilityActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('observability:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = z.object({ id: z.string().uuid('Invalid error') }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('error_events')
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: actor.userId })
    .eq('id', id)
    .eq('resolved', false)
    .select('id, fingerprint')
    .maybeSingle();
  if (error) {
    console.error('[admin] resolveError error', error);
    return { ok: false, error: 'Could not resolve the error.' };
  }
  if (!data) return { ok: false, error: 'Error not found or already resolved.' };

  const fingerprint = (data as { fingerprint: string }).fingerprint;

  // Keep the linked monitoring alert in sync (best-effort).
  await svc
    .from('system_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('dedupe_key', `error:${fingerprint}`)
    .eq('resolved', false);

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'error.resolved',
    p_entity_type: 'error_event',
    p_entity_id: id,
    p_metadata: { reason: 'manual', fingerprint },
  });

  revalidatePath('/admin/errors');
  revalidatePath(`/admin/errors/${id}`);
  return { ok: true };
}
