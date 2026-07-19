'use server';

import { randomUUID } from 'crypto';
import { requireProductCapability } from '@/lib/products/access';
import { presignPut, ALLOWED_CONTENT_TYPES } from '@/lib/r2';
import { CoverPresignSchema } from '@/lib/validations';

/**
 * Mint a presigned PUT so the admin's browser uploads a product cover/gallery image straight to
 * R2 (the same direct-to-R2 pattern as cover artwork). Gated by `product:manage`. The returned
 * `key` is then handed to the Phase A `setProductCoverPreview` / `addProductPreview` actions.
 * Separate module so the Phase A product action layer stays untouched.
 */
const KEY_PREFIX = 'album-products/';

export async function presignProductUpload(
  input: unknown,
): Promise<{ ok: true; uploadUrl: string; key: string } | { ok: false; error: string }> {
  try {
    await requireProductCapability();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }
  const parsed = CoverPresignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { contentType, size } = parsed.data;

  const ext = ALLOWED_CONTENT_TYPES[contentType];
  const key = `${KEY_PREFIX}${randomUUID()}.${ext}`;
  try {
    const uploadUrl = await presignPut({ key, contentType, contentLength: size });
    return { ok: true, uploadUrl, key };
  } catch (e) {
    console.error('[admin] presignProductUpload error', e);
    return { ok: false, error: 'Could not start the upload.' };
  }
}
