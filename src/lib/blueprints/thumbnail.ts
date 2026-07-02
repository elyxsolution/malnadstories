import 'server-only';

import { randomBytes, createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { enqueueBlueprintThumbnail } from '@/lib/queue';
import { probeWorker } from '@/lib/worker/health';

/**
 * Blueprint thumbnail generation service (0044) — the single place that mints the render token,
 * stores its hash + expiry on the layout_templates row, enqueues the worker job, and best-effort
 * wakes the sleepable worker. Mirrors startAlbumPdfGeneration. Service-role; callers authorize
 * first (admin blueprint actions). NEVER throws — thumbnail generation is best-effort, and the UI
 * always falls back to a count placeholder when thumb_key is missing.
 */
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches the album-pdf print token

export async function startBlueprintThumbnail(blueprintId: string): Promise<void> {
  try {
    const svc = createServiceClient();

    // Only generate for rows that ARE blueprints (blueprint jsonb present).
    const { data } = await svc
      .from('layout_templates')
      .select('id, blueprint')
      .eq('id', blueprintId)
      .maybeSingle();
    const row = data as { id: string; blueprint: unknown } | null;
    if (!row || !row.blueprint) return;

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { error } = await svc
      .from('layout_templates')
      .update({ preview_token_hash: tokenHash, preview_token_expires_at: expiresAt })
      .eq('id', blueprintId);
    if (error) {
      console.error('[blueprint-thumb] token store failed', { blueprintId, error: error.message });
      return;
    }

    try {
      const jobId = await enqueueBlueprintThumbnail(blueprintId, token);
      console.log('[blueprint-thumb] queued', { blueprintId, jobId, tokenHash: tokenHash.slice(0, 8) });
    } catch (e) {
      console.error('[blueprint-thumb] enqueue failed', { blueprintId, error: String(e) });
      return;
    }

    // Wake the (sleepable) worker so it drains the job promptly. Best-effort.
    probeWorker(2500).catch(() => {});
  } catch (e) {
    console.error('[blueprint-thumb] start error (non-fatal)', { blueprintId, error: String(e) });
  }
}
