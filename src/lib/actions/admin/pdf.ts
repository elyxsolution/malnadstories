'use server';

import { z } from 'zod';
import { requireCapability } from '@/lib/auth/require-admin';
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';

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
