import sharp from 'sharp';
import { supabase } from '../supabase.js';
import { getObjectBuffer, putObject } from '../r2.js';

/**
 * Cover-template thumbnail + dimensions job.
 *
 * Admin cover artwork is uploaded straight to R2 (presign → PUT), so the app never
 * sees the bytes. This trusted backend job downloads the master, records its pixel
 * dimensions (used for the print-safety gate + a "low resolution" admin warning), and
 * produces a ~400px thumbnail for the catalogue grid + customer pickers (so those
 * surfaces never presign multi-MB masters). Idempotent: re-running just overwrites.
 *
 * Covers are TRUSTED admin assets, so unlike user photos they are not magic-byte
 * validated / re-encoded here — only measured + thumbnailed. A decode failure marks
 * nothing destructive; it simply leaves thumb_key null (pickers fall back to the master)
 * and dimensions null (the PDF gate treats unknown as "let it through, log").
 */
export async function generateCoverThumbnail(input: { coverTemplateId: string }): Promise<void> {
  const { coverTemplateId } = input;

  const { data: row } = await supabase
    .from('cover_templates')
    .select('id, image_key')
    .eq('id', coverTemplateId)
    .maybeSingle();
  const cover = row as { id: string; image_key: string } | null;
  if (!cover) {
    console.warn(`[worker] cover-thumbnail: template ${coverTemplateId} not found (deleted?) — skipping`);
    return;
  }

  let raw: Buffer;
  try {
    raw = await getObjectBuffer(cover.image_key);
  } catch (err) {
    // Transient/network — throw so pg-boss retries.
    throw new Error(`cover-thumbnail: could not download ${cover.image_key}: ${(err as Error).message}`);
  }

  let width: number | null = null;
  let height: number | null = null;
  let thumbKey: string | null = null;
  try {
    const meta = await sharp(raw).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;

    const thumb = await sharp(raw)
      .rotate()
      .resize({ width: 400, height: 533, fit: 'inside', withoutEnlargement: true }) // ~3:4
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    // Derive a stable thumb key alongside the master: cover-templates/<uuid>_thumb.jpg
    thumbKey = cover.image_key.replace(/\.[^./]+$/, '') + '_thumb.jpg';
    await putObject(thumbKey, thumb, 'image/jpeg');
  } catch (err) {
    // Non-fatal: leave thumb null (pickers fall back to the master). Still record any
    // dimensions we managed to read so the PDF gate has something to check.
    console.error(`[worker] cover-thumbnail: processing failed for ${coverTemplateId}: ${(err as Error).message}`);
  }

  const { error } = await supabase
    .from('cover_templates')
    .update({ thumb_key: thumbKey, width, height })
    .eq('id', coverTemplateId);
  if (error) {
    throw new Error(`cover-thumbnail: db update failed for ${coverTemplateId}: ${error.message}`);
  }

  console.log(`[worker] cover-thumbnail ready for ${coverTemplateId}`, { width, height, hasThumb: !!thumbKey });
}
