/**
 * THE PHOTO DOMAIN MODEL — the shape every surface agrees on for "a photo in an album".
 *
 * WHY IT LIVES HERE. This type used to be declared in `build/_uploader.tsx`, a `'use client'`
 * component inside a route folder, and had grown to eighteen importers — among them
 * `lib/admin/album-view.ts`, which is `import 'server-only'`. A server module depending on a
 * client component for its domain type is a layering inversion: it compiled only because the
 * import was type-only and therefore erased, and was one non-type import away from breaking.
 *
 * Moving it into `lib/builder/` — beside `model.ts` and `photo-url.ts`, the other shared
 * builder-domain modules — puts the dependency arrow the right way round: UI, server helpers
 * and the print route all depend on the domain, and the domain depends on nothing but types.
 *
 * The shape is UNCHANGED. Fields are documented by origin, because who writes a field is the
 * thing that keeps being asked:
 *   • server-owned  — hydrated from `photos` and refreshed by the poll,
 *   • client-only   — never persisted, never sent, dropped on reload.
 */

import type { EditConfig } from './model';
import type { ClientImageMetadata } from '@/lib/uploads/metadata';

/** Server-side processing state of a photo row. */
export type PhotoStatus = 'pending' | 'ready' | 'rejected';

export type Photo = {
  /** Server photo id, or a `tmp_…` optimistic id until the upload confirms (Phase 3). */
  id: string;
  /** SERVER: sanitized full-res signed URL (empty until status='ready'). */
  url: string;
  /** SERVER: sanitized thumbnail signed URL (empty until status='ready'). */
  thumbUrl: string;
  filename: string;
  edit: EditConfig | null;
  status: PhotoStatus;
  takenAt: string | null;
  /**
   * SERVER: sanitized image dimensions (worker-populated). Read-only; used for the auto-layout
   * engine's orientation classification. Null until the photo is processed.
   */
  width?: number | null;
  height?: number | null;
  /**
   * CLIENT-ONLY: local `blob:` preview handed over from the upload that created this row, so the
   * tray keeps showing the user's own file while the worker sanitizes it. Never persisted, never
   * sent to the server, and cleared (+ revoked) once the processed image has actually loaded.
   * Absent for photos hydrated from the server on page load.
   */
  localUrl?: string | null;
  /**
   * CLIENT-ONLY: dimensions + EXIF orientation read in the BROWSER from the user's own file,
   * available within milliseconds of picking it (Phase 4). Advisory: it lets layout run before
   * the worker finishes, and is reconciled against the authoritative `width`/`height` the moment
   * those arrive. Null for HEIC and for anything we couldn't measure confidently.
   */
  clientMeta?: ClientImageMetadata | null;
  /**
   * CLIENT-ONLY: when the WORKER started on this photo (ms epoch) — set on confirm. Drives the
   * escalating "Processing → Enhancing → Almost there" copy. Null for photos hydrated on page
   * load, whose true age we can't know; those simply never escalate rather than guessing.
   */
  processingSince?: number | null;
  /**
   * CLIENT-ONLY: when the current signed URL was minted (ms epoch). Signed R2 URLs live 10
   * minutes, so this is what lets the builder refresh JUST the photos that are aging out,
   * instead of re-pointing every image in the album (Phase 5).
   */
  urlIssuedAt?: number | null;
};
