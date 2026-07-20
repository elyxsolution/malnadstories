'use server';

import { z } from 'zod';
import { requireCapability } from '@/lib/auth/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';
import { loadAlbumValidation } from '@/lib/albums/validation';

export type AdminPdfResult = { ok: true } | { ok: false; error: string };

const AlbumId = z.string().uuid();

/**
 * Admin-only: (re)generate an album's preview PDF for ANY album.
 *
 * PDF generation is a backend workflow — customers never trigger it. Admins keep full
 * control here: requireAdmin() authorizes, then the shared service-role generator mints
 * a token, flips status, enqueues, and nudges the worker. `force` always regenerates.
 */
export async function adminGenerateAlbumPdf(input: unknown): Promise<AdminPdfResult> {
  try {
    await requireCapability('album:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = AlbumId.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid album id' };

  const res = await startAlbumPdfGeneration(parsed.data, { force: true, validate: true, nudge: true });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

const ForceSchema = z.object({
  albumId: z.string().uuid(),
  reason: z.string().trim().min(8, 'Please give a clear reason (at least 8 characters).').max(500),
});

/**
 * Admin FORCE-GENERATE override (CHANGE 5/10/11): generate the PDF even when the album is NOT
 * print-ready. This is the ONLY path that bypasses the central validation gate (`validate:false`),
 * and it is reachable exclusively through this explicit, capability-gated admin action — the worker
 * never decides to ignore validation on its own (CHANGE 11). Every override is AUDITED with the
 * admin, timestamp, reason, and the full validation snapshot (score/version/blocking issues) before
 * the PDF is enqueued (CHANGE 12). The centralized validation service is read, never re-implemented.
 */
export async function adminForceGeneratePdf(input: unknown): Promise<AdminPdfResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('album:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = ForceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { albumId, reason } = parsed.data;

  const svc = createServiceClient();

  // Snapshot the CURRENT centralized validation report for the audit record (what was overridden).
  const report = await loadAlbumValidation(svc, albumId);
  const blocking = report ? [...report.critical, ...report.warnings].map((i) => i.title) : [];

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: 'pdf.force_generated',
    p_entity_type: 'album',
    p_entity_id: albumId,
    p_metadata: {
      reason,
      overrode_validation: true,
      validation_version: report?.version ?? null,
      validation_score: report?.statistics.score ?? null,
      print_ready: report?.printReady ?? null,
      blocking_issues: blocking,
    },
  });

  // Explicit override → generate WITHOUT the content-validation OR render-readiness gate. `force:true`
  // re-drives even a failed/idle row; `override:true` is the single audited bypass of both gates. The
  // worker still renders from live album data (and only ever draws 'ready' photos).
  const res = await startAlbumPdfGeneration(albumId, { force: true, override: true, nudge: true });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
