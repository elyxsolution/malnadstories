'use server';

import { z } from 'zod';
import { requireCapability } from '@/lib/auth/require-admin';
import { createServiceClient } from '@/lib/supabase/service';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';
import { loadAlbumValidation } from '@/lib/albums/validation';
import { PRINT_PDF_KINDS } from '@/lib/pdf/kind';

export type AdminPdfResult = { ok: true } | { ok: false; error: string };

const AlbumId = z.string().uuid();

/**
 * The printer-ready exports (0058). ADMIN-ON-DEMAND ONLY — deliberately not in `PDF_KINDS`, so a
 * caller cannot pass `'preview'` here and drive the customer artifact through the print controls.
 */
const PrintKind = z.enum(PRINT_PDF_KINDS);
const PrintPdfSchema = z.object({ albumId: AlbumId, kind: PrintKind });

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

/**
 * Admin-only: (re)generate one of the PRINTER-READY exports for any album (0058).
 *
 *   print_cover    the flat cover spread, 483 x 327 mm, one page.
 *   print_content  the interior, N x 206 x 291 mm pages in reading order.
 *
 * ADMIN-ON-DEMAND, ALWAYS. Nothing else in the system starts these: not the Razorpay webhook, not
 * `/api/payments/verify`, not the settlement cascade, not album creation or submission. A print
 * file is produced when a book actually goes to production, and it is an administrator who decides
 * that. The preview PDF's payment-triggered lifecycle is untouched.
 *
 * Same capability as the preview control (`album:manage`), same shared generator, same gates —
 * `force: true` so an admin's click always re-renders against the album's current state, plus (for
 * the interior) a page-count pre-flight that refuses a file with the wrong number of leaves.
 */
export async function adminGeneratePrintPdf(input: unknown): Promise<AdminPdfResult> {
  try {
    await requireCapability('album:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = PrintPdfSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid print export request' };

  const res = await startAlbumPdfGeneration(parsed.data.albumId, {
    kind: parsed.data.kind,
    force: true,
    validate: true,
    nudge: true,
  });
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
