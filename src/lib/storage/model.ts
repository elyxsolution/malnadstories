/**
 * Storage console — size model (Phase 11A+).
 *
 * IMPORTANT: no byte size is stored anywhere (photos has width/height only; album_pdfs
 * has none), and scanning the R2 bucket is forbidden (Phase 10). So EVERY size here is a
 * DB-derived ESTIMATE from metadata, and the UI labels it "≈". These constants are the
 * single place to tune the heuristics.
 */

// q90 photographic JPEG master ≈ 0.30 bytes/oriented-pixel; thumbnail ≈ a small flat add.
export const BYTES_PER_PIXEL_JPEG = 0.3;
export const THUMB_BYTES = 30_000;
// A ready photo whose dimensions are unknown → a conservative flat estimate.
export const FLAT_PHOTO_BYTES = 2_500_000;
// Preview PDF ≈ per album content page.
export const PDF_BYTES_PER_PAGE = 220_000;

/** Retention rule: a delivered order's assets become eligible this many days after delivery. */
export const RETENTION_DAYS = 30;

export type Priority = 'high' | 'medium' | 'low';

export function estimatePhotoBytes(width: number | null, height: number | null): number {
  if (width && height && width > 0 && height > 0) {
    return Math.round(width * height * BYTES_PER_PIXEL_JPEG) + THUMB_BYTES;
  }
  return FLAT_PHOTO_BYTES;
}

export function estimatePdfBytes(pages: number): number {
  return Math.max(1, pages) * PDF_BYTES_PER_PAGE;
}

/** Human byte size. Binary units; one decimal above KB. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Cleanup priority — older + larger reclaim wins. Pure presentation cue. */
export function cleanupPriority(daysSinceDelivery: number, bytes: number): Priority {
  if (daysSinceDelivery >= 90 || bytes >= 80_000_000) return 'high';
  if (daysSinceDelivery >= 60 || bytes >= 25_000_000) return 'medium';
  return 'low';
}

export const PRIORITY_CHIP: Record<Priority, string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-muted text-muted-foreground',
};
