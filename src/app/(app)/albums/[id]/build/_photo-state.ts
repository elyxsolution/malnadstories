'use client';

import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { UploadTask } from '@/lib/uploads';
import type { Photo } from '@/lib/builder/photo';

/**
 * ONE derivation of "what state is this photo in", used by every surface that draws a photo.
 *
 * There is no `state` field on `Photo`. The truth already exists in two places that cannot
 * disagree — the photo's own `status` (what the server says) and its upload task (what the
 * client is doing about it) — so the state is DERIVED from them rather than stored a third
 * time. Nothing to keep in sync, nothing to drift.
 *
 * Ordering matters: the upload task wins while the photo is still optimistic, because the
 * server has no opinion yet; once the photo is real, `status` takes over.
 */
export type PhotoUiState = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Resolve the display state of a photo. `task` is its upload, when it still has one. */
export function photoUiState(photo: Photo, task: UploadTask | undefined): PhotoUiState {
  if (photo.status === 'rejected') return 'failed';
  if (photo.status === 'ready') return 'ready';

  // Optimistic: the upload task is the only thing that knows anything.
  if (task) {
    if (task.state === 'failed') return 'failed';
    if (task.state === 'queued' || task.state === 'local') return 'queued';
    if (task.state === 'uploading') return 'uploading';
  }
  // Confirmed on the server, worker still working (or hydrated as `pending` on page load).
  return 'processing';
}

/**
 * Can this photo be placed into a layout?
 *
 * The bar is deliberately "is there something to draw", not "is it processed" — that is the
 * whole point of Phase 3. A photo qualifies once it has ANY renderable image, which for an
 * optimistic photo is its local blob.
 *
 * Two exclusions, both because the photo can never become printable:
 *   • `failed` — a rejected photo, or an upload that will not complete.
 *   • no preview — HEIC has no browser-decodable preview, so placing it would put an empty
 *     frame on the page with nothing to show. It becomes placeable when the worker's JPEG
 *     lands, which is the first moment it can actually be seen.
 */
export function isPlaceable(photo: Photo, state: PhotoUiState): boolean {
  if (state === 'failed') return false;
  return resolvePhotoUrl(photo, 'thumb') !== null;
}

// ── oriented geometry (Phase 4) ───────────────────────────────────────────────────

/** Where a photo's dimensions came from. `client` values are advisory until confirmed. */
export type DimensionSource = 'server' | 'client' | null;

export type OrientedSize = { width: number; height: number; source: Exclude<DimensionSource, null> };

/**
 * THE single accessor for a photo's ORIENTED pixel size — the one convention everything
 * geometric in the builder shares.
 *
 * "Oriented" means EXIF rotation has already been applied, so width/height describe the image
 * as it is DISPLAYED. Both sources agree on that convention by construction: the worker bakes
 * the rotation in (`sharp.rotate()`), and client extraction decodes with
 * `imageOrientation: 'from-image'`. That shared convention is what makes it safe to start with
 * client numbers and swap in server ones later without anything shifting.
 *
 * The server always wins when present — it is the source of truth.
 */
export function orientedSize(photo: Photo): OrientedSize | null {
  if (photo.width && photo.height && photo.width > 0 && photo.height > 0) {
    return { width: photo.width, height: photo.height, source: 'server' };
  }
  const meta = photo.clientMeta;
  if (meta?.reliable && meta.width > 0 && meta.height > 0) {
    return { width: meta.width, height: meta.height, source: 'client' };
  }
  return null;
}

/** Oriented aspect ratio (w/h), from whichever source is available. */
export function orientedAspect(photo: Photo): number | null {
  const size = orientedSize(photo);
  return size ? size.width / size.height : null;
}

/**
 * CROP-SPACE FOUNDATION (Phase 4, groundwork only — no crop editing here).
 *
 * `EditConfig.crop` is a normalized rect in ORIENTED image space: x/y/w/h are fractions of the
 * displayed image, not of the stored pixels. That is why `orientedSize` exists and why both
 * metadata sources are normalized to the same convention — a crop authored against a client
 * preview describes the same region of the same picture once the sanitized master replaces it.
 *
 * This helper is the conversion a future crop editor will need: normalized rect → concrete
 * pixels in whichever oriented space is currently known. It is exported now so that when crop
 * editing arrives it has one correct place to start, rather than re-deriving the convention.
 */
export function cropToPixels(
  photo: Photo,
  crop: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number; source: Exclude<DimensionSource, null> } | null {
  const size = orientedSize(photo);
  if (!size) return null;
  return {
    x: crop.x * size.width,
    y: crop.y * size.height,
    w: crop.w * size.width,
    h: crop.h * size.height,
    source: size.source,
  };
}

// ── long-processing escalation ────────────────────────────────────────────────────

/** Copy for a photo that has been processing for `elapsedMs`. Never implies failure. */
export function processingLabel(elapsedMs: number | null): string {
  if (elapsedMs === null) return 'Processing';
  if (elapsedMs < 15_000) return 'Processing';
  if (elapsedMs < 45_000) return 'Enhancing';
  return 'Almost there';
}

/** The longer form, for the status strip where there is room for a sentence. */
export function processingSentence(elapsedMs: number | null): string {
  if (elapsedMs === null || elapsedMs < 15_000) return 'Processing your photos…';
  if (elapsedMs < 45_000) return 'Enhancing your photos…';
  return 'This is taking a little longer than usual — still working.';
}
