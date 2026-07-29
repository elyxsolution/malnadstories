/**
 * THE photo URL resolver — the single place that decides which image URL a photo
 * should render with, and the lifecycle helpers for local (blob) previews.
 *
 * WHY THIS EXISTS. A photo can be renderable from several sources at different points
 * in its life: the sanitized thumbnail, the sanitized full-res master, or — before the
 * worker has produced either — a local `blob:` URL of the file the user just picked.
 * Before this module every consumer reached for `photo.url` / `photo.thumbUrl`
 * directly, so adding a new source meant touching a dozen components. Now they all ask
 * here, and future phases extend the chain in ONE place.
 *
 * THE CHAIN (thumb variant, the default):  thumbUrl → url → localUrl → null
 *            (full variant):               url → thumbUrl → localUrl → null
 *
 * The two variants share the same sources; only the preference order differs. A full
 * -page slot must never downgrade to the 400px thumbnail while the master is in hand,
 * and the tray must never pull a multi-megabyte master for a 100px tile — so the caller
 * states which one it is rendering and the resolver honours it.
 *
 * `null` means "no image available" — the caller renders its own processing/empty
 * placeholder. The resolver deliberately does NOT invent a placeholder URL: placeholders
 * are layout, not image data.
 *
 * PURITY. The resolver itself is pure and environment-agnostic (it is reachable from the
 * print route and from `@builder/*` in the worker). The blob helpers below touch browser
 * APIs only INSIDE their function bodies, so importing this module outside a browser is
 * safe as long as those functions aren't called.
 */

export type PhotoUrlVariant = 'thumb' | 'full';

/**
 * The structural shape the resolver needs. Deliberately NOT the full `Photo` type: keeping it
 * structural lets any photo-ish object flow through (an upload task, a partial row) without
 * this module depending on the whole domain model.
 */
export type PhotoUrlSource = {
  /** Sanitized full-res master (signed). Empty/absent until the worker finishes. */
  url?: string | null;
  /** Sanitized ~400px thumbnail (signed). Empty/absent until the worker finishes. */
  thumbUrl?: string | null;
  /** Local `blob:` preview of the user's own file — instant, client-only, never persisted. */
  localUrl?: string | null;
};

/**
 * Resolve the best available URL for `photo` at `variant`, or `null` when the photo has
 * nothing renderable yet (still processing with no local preview, or rejected).
 */
export function resolvePhotoUrl(
  photo: PhotoUrlSource | null | undefined,
  variant: PhotoUrlVariant = 'thumb',
): string | null {
  if (!photo) return null;
  const chain =
    variant === 'thumb'
      ? [photo.thumbUrl, photo.url, photo.localUrl]
      : [photo.url, photo.thumbUrl, photo.localUrl];
  for (const candidate of chain) {
    if (candidate) return candidate;
  }
  return null;
}

// ── Local preview lifecycle ──────────────────────────────────────────────────────

/**
 * Content types every target browser can decode in an `<img>`.
 *
 * HEIC is deliberately EXCLUDED. Chrome, Firefox and Android cannot render `image/heic`,
 * so a blob URL for one yields a broken image rather than a preview. HEIC uploads are
 * unaffected — they simply keep the existing "Processing…" placeholder until the worker
 * transcodes them to JPEG. A static allow-list is used rather than feature detection so
 * the outcome is deterministic and can never produce a broken-image flash.
 */
export const LOCAL_PREVIEW_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** Can this content type be previewed locally, before the worker has processed it? */
export function canPreviewLocally(contentType: string): boolean {
  return LOCAL_PREVIEW_TYPES.includes(contentType);
}

/**
 * Create a local preview URL for a just-picked file, or `null` when the type can't be
 * previewed (HEIC) or the API is unavailable. The caller OWNS the returned URL and must
 * revoke it exactly once — see `revokeLocalPreview`.
 */
export function createLocalPreview(file: File, contentType: string): string | null {
  if (typeof window === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
  if (!canPreviewLocally(contentType)) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    // Quota/security failure — previewing is an enhancement, never a requirement.
    return null;
  }
}

/**
 * Release a local preview. Safe to call with null/undefined, with a non-blob URL, or
 * twice on the same URL (revoking an already-revoked object URL is a no-op), so callers
 * never need their own guards.
 */
export function revokeLocalPreview(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  if (typeof window === 'undefined' || typeof URL?.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already released / unavailable — nothing to do */
  }
}

/**
 * Warm the browser cache for `url` and report whether it actually decoded.
 *
 * This is the gate for swapping a local preview out: we only drop the blob once the
 * processed image is proven loadable, so the tray never flashes an empty tile. Resolves
 * `false` on error (a broken or expired signed URL) — in which case the caller must KEEP
 * the blob, because it is then the only working preview.
 */
export function preloadImage(url: string): Promise<boolean> {
  if (typeof window === 'undefined' || !url) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
