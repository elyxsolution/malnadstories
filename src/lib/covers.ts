import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { presignGet } from '@/lib/r2';

/**
 * Cover-template read model + print-safety policy.
 *
 * A CoverOption carries BOTH a thumbnail URL (grid/picker — cheap) and the full master
 * URL (large "Preview Cover" modal + the album's page-1 preview render). thumbUrl falls
 * back to the master until the worker has produced a thumbnail.
 */
export type CoverOption = {
  id: string;
  name: string;
  description: string | null;
  url: string; // full master (presigned)
  thumbUrl: string; // thumbnail (presigned), falls back to master
};

type Row = { id: string; name: string; description: string | null; image_key: string; thumb_key: string | null };

// The cover is physical page 1 at 6in × 8in. Professional target = 300 DPI
// (1800 × 2400). We BLOCK PDF generation only below a hard floor (~200 DPI) so a
// genuinely tiny cover can't ship; between floor and target we only WARN the admin.
export const COVER_PAGE_INCHES = { w: 6, h: 8 } as const;
export const COVER_DPI_TARGET = 300;
export const COVER_DPI_FLOOR = 200;
export const COVER_MIN_PRINT = {
  width: COVER_PAGE_INCHES.w * COVER_DPI_FLOOR, // 1200
  height: COVER_PAGE_INCHES.h * COVER_DPI_FLOOR, // 1600
};
export const COVER_RECOMMENDED = {
  width: COVER_PAGE_INCHES.w * COVER_DPI_TARGET, // 1800
  height: COVER_PAGE_INCHES.h * COVER_DPI_TARGET, // 2400
};

export type CoverResolution = { ok: boolean; known: boolean; belowRecommended: boolean };

/**
 * Print-safety check for a cover's pixel dimensions (populated by the cover-thumbnail
 * worker job). Unknown dimensions → ok:true (don't block a cover whose job hasn't run
 * yet), but flagged known:false so callers can decide. Below the floor → ok:false.
 */
export function checkCoverResolution(width: number | null, height: number | null): CoverResolution {
  if (!width || !height) return { ok: true, known: false, belowRecommended: true };
  const ok = width >= COVER_MIN_PRINT.width && height >= COVER_MIN_PRINT.height;
  const belowRecommended = width < COVER_RECOMMENDED.width || height < COVER_RECOMMENDED.height;
  return { ok, known: true, belowRecommended };
}

/** Active cover designs for customer-facing pickers (creation modal + builder). */
export async function listActiveCoverOptions(): Promise<CoverOption[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('cover_templates')
    .select('id, name, description, image_key, thumb_key')
    .eq('active', true)
    .order('sort', { ascending: true });

  return Promise.all(
    ((data ?? []) as Row[]).map(async (c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      url: await presignGet(c.image_key, 3600),
      thumbUrl: await presignGet(c.thumb_key ?? c.image_key, 3600),
    })),
  );
}
