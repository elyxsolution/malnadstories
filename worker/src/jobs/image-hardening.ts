import { z } from 'zod';
import { supabase } from '../supabase.js';
import { getObjectBuffer, putObject, deleteObject } from '../r2.js';
import { hardenImage, InvalidImageError } from '../lib/image.js';
import { env } from '../env.js';
import { captureMessage } from '../lib/observability.js';

const JobSchema = z.object({ photoId: z.string().uuid() });

type PhotoRow = {
  id: string;
  user_id: string;
  album_id: string | null;
  r2_key: string | null;
  status: string;
};

/** Replace the raw key's extension to derive stable sanitized/thumbnail keys. */
function derivedKeys(rawKey: string) {
  const base = rawKey.replace(/\.[^./]+$/, '');
  return { sanitizedKey: `${base}_full.jpg`, thumbKey: `${base}_thumb.jpg` };
}

async function reject(photoId: string, reason: string) {
  console.warn(`[worker] rejecting photo ${photoId}: ${reason}`);
  await supabase.from('photos').update({ status: 'rejected' }).eq('id', photoId);
  // Visibility (warning): a permanent rejection (spoofed/undecodable/too large). Deduped by
  // normalized reason so a recurring bad-upload pattern is one row, not thousands.
  await captureMessage(`Photo rejected during hardening: ${reason}`, {
    source: 'image-hardening',
    category: 'upload',
    severity: 'warning',
    metadata: { photoId, reason },
  });
}

/**
 * Process one photo end-to-end. Idempotent: a row that's already 'ready' (or gone)
 * is skipped. Throws on TRANSIENT failures so pg-boss retries; marks 'rejected'
 * (and returns) on PERMANENT failures so they don't retry.
 */
export async function processPhoto(rawInput: unknown): Promise<void> {
  const parsed = JobSchema.safeParse(rawInput);
  if (!parsed.success) {
    console.error('[worker] invalid job payload, dropping:', parsed.error.issues[0]?.message);
    return; // bad payload — nothing to retry
  }
  const { photoId } = parsed.data;

  const { data, error } = await supabase
    .from('photos')
    .select('id, user_id, album_id, r2_key, status')
    .eq('id', photoId)
    .maybeSingle();
  if (error) throw new Error(`load photo failed: ${error.message}`); // transient → retry

  const photo = data as PhotoRow | null;
  if (!photo) {
    console.warn(`[worker] photo ${photoId} not found — skipping`);
    return;
  }
  if (photo.status === 'ready') return; // already processed (idempotent)
  if (!photo.r2_key) {
    await reject(photoId, 'no raw object key');
    return;
  }

  // Defense-in-depth: the raw key must live under this user's album prefix.
  const expectedPrefix = `${photo.user_id}/albums/${photo.album_id}/`;
  if (!photo.r2_key.startsWith(expectedPrefix)) {
    await reject(photoId, `unexpected key prefix: ${photo.r2_key}`);
    return;
  }

  const raw = await getObjectBuffer(photo.r2_key); // transient errors throw → retry

  let processed;
  try {
    processed = await hardenImage(raw);
  } catch (err) {
    if (err instanceof InvalidImageError) {
      await reject(photoId, err.message);
      if (!env.KEEP_RAW_ORIGINAL) await deleteObject(photo.r2_key).catch(() => {});
      return;
    }
    throw err; // unexpected/transient → let pg-boss retry
  }

  const { sanitizedKey, thumbKey } = derivedKeys(photo.r2_key);
  await putObject(sanitizedKey, processed.full, 'image/jpeg');
  await putObject(thumbKey, processed.thumb, 'image/jpeg');

  const deleteRaw = !env.KEEP_RAW_ORIGINAL;
  const { error: updateError } = await supabase
    .from('photos')
    .update({
      status: 'ready',
      sanitized_key: sanitizedKey,
      thumb_key: thumbKey,
      width: processed.width,
      height: processed.height,
      taken_at: processed.takenAt ? processed.takenAt.toISOString() : null,
      r2_key: deleteRaw ? null : photo.r2_key,
    })
    .eq('id', photoId);
  if (updateError) throw new Error(`update photo failed: ${updateError.message}`);

  // Only delete the raw AFTER the row points at the sanitized derivatives, so a
  // crash never leaves a 'ready' row whose master upload or DB write didn't land.
  if (deleteRaw) {
    await deleteObject(photo.r2_key).catch((e) => console.warn(`[worker] raw delete failed: ${e.message}`));
  }

  console.log(`[worker] photo ${photoId} ready (${processed.width}x${processed.height})`);
}
