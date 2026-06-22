'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability } from '@/lib/auth/require-admin';
import { enqueueR2Cleanup } from '@/lib/queue';
import { estimatePhotoBytes, estimatePdfBytes, RETENTION_DAYS } from '@/lib/storage/model';

export type PurgeResult = { ok: true; reclaimed: number } | { ok: false; error: string };

const PurgeSchema = z.object({
  albumId: z.string().uuid(),
  mode: z.enum(['pdf', 'photos', 'all']),
});

/**
 * Storage cleanup (Phase 11A+). Deletes R2 OBJECTS ONLY for an eligible (delivered +
 * RETENTION_DAYS) album, then nulls the now-dangling key columns so nothing tries to serve
 * a deleted object. Rows + all metadata + history REMAIN — never touches orders, payments,
 * reviews, support, or customers. Gated by storage:manage; audited via log_audit. No
 * automatic deletion — only this explicit, admin-initiated action.
 */
export async function purgeAlbumAssets(input: unknown): Promise<PurgeResult> {
  let actor: { userId: string };
  try {
    actor = await requireCapability('storage:manage');
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = PurgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid request' };
  const { albumId, mode } = parsed.data;

  const svc = createServiceClient();

  // Eligibility (server-enforced safety): the album must have a delivered order older than
  // the retention window. This prevents purging assets of an in-progress/just-delivered album.
  const { data: ord } = await svc
    .from('orders')
    .select('id, delivered_at, placed_at')
    .eq('album_id', albumId)
    .eq('status', 'delivered')
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const order = ord as { id: string; delivered_at: string | null; placed_at: string } | null;
  if (!order) return { ok: false, error: 'This album has no delivered order — not eligible for cleanup.' };
  const effectiveAt = new Date(order.delivered_at ?? order.placed_at).getTime();
  if (Date.now() - effectiveAt < RETENTION_DAYS * 86_400_000) {
    return { ok: false, error: `Not yet eligible — assets are retained for ${RETENTION_DAYS} days after delivery.` };
  }

  const keys: string[] = [];
  let reclaimed = 0;
  let photoCount = 0;
  let pdfPurged = false;

  if (mode === 'photos' || mode === 'all') {
    const { data } = await svc
      .from('photos')
      .select('width, height, sanitized_key, thumb_key, r2_key')
      .eq('album_id', albumId);
    const rows = (data ?? []) as {
      width: number | null;
      height: number | null;
      sanitized_key: string | null;
      thumb_key: string | null;
      r2_key: string | null;
    }[];
    for (const p of rows) {
      const ks = [p.sanitized_key, p.thumb_key, p.r2_key].filter((k): k is string => !!k);
      if (ks.length === 0) continue;
      keys.push(...ks);
      reclaimed += estimatePhotoBytes(p.width, p.height);
      photoCount += 1;
    }
  }

  if (mode === 'pdf' || mode === 'all') {
    const { data: pdf } = await svc.from('album_pdfs').select('r2_key').eq('album_id', albumId).maybeSingle();
    const key = (pdf as { r2_key: string | null } | null)?.r2_key;
    if (key) {
      keys.push(key);
      pdfPurged = true;
      const { data: al } = await svc.from('albums').select('size').eq('id', albumId).maybeSingle();
      reclaimed += estimatePdfBytes((al as { size: number } | null)?.size ?? 36);
    }
  }

  if (keys.length === 0) return { ok: false, error: 'Nothing to delete — these assets were already reclaimed.' };

  // Delete the R2 objects ONLY (worker job; idempotent + retried). Rows are NOT deleted.
  try {
    await enqueueR2Cleanup(keys);
  } catch {
    return { ok: false, error: 'Could not start cleanup. Please try again.' };
  }

  // Null the dangling keys so the app never presigns a deleted object. Metadata rows remain;
  // a PDF can be regenerated later (status → idle).
  if (mode === 'photos' || mode === 'all') {
    await svc.from('photos').update({ sanitized_key: null, thumb_key: null, r2_key: null }).eq('album_id', albumId);
  }
  if (mode === 'pdf' || mode === 'all') {
    await svc.from('album_pdfs').update({ r2_key: null, status: 'idle' }).eq('album_id', albumId);
  }

  await svc.rpc('log_audit', {
    p_actor_id: actor.userId,
    p_actor_type: 'admin',
    p_action: mode === 'pdf' ? 'storage.purged_pdf' : mode === 'photos' ? 'storage.purged_photos' : 'storage.purged_all',
    p_entity_type: 'storage',
    p_entity_id: albumId,
    p_metadata: { album_id: albumId, order_id: order.id, reclaimed_estimate: reclaimed, photos: photoCount, pdf: pdfPurged, keys: keys.length },
  });

  revalidateTag('storage-metrics');
  revalidatePath('/admin/storage');
  return { ok: true, reclaimed };
}
