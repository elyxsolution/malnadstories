/**
 * WHAT AN IMAGE ADJUSTMENT IS ACTING ON.
 *
 * Every crop, zoom, pan, rotation, straighten, flip and tone slider in the builder used to be
 * addressed by PHOTO ID, because a photo could be placed exactly once and so "this photo" and
 * "this frame" named the same thing. They are different things now: one uploaded image can sit on
 * page 1, page 5 and the back cover, and adjusting the back cover must leave the two pages alone.
 *
 * So an adjustment names a FRAME. `FrameRef` is that name, and it has three shapes because there
 * are exactly three kinds of container in this builder — a page's base slot, an overlay (on a page
 * OR on a cover face, which are the same object), and the tray tile, which is not a placement at
 * all but the SOURCE ASSET itself.
 *
 *   kind: 'source'  → writes `photos.edit_config`, the default every unforked placement inherits.
 *                     This is what the tray's Edit and the tray's Rotate have always meant, and
 *                     they still mean it.
 *   kind: 'base'    → writes `block.baseEdits[slot]`.
 *   kind: 'overlay' → writes `overlay.edit`, on a page block or on `cover:<side>`.
 *
 * PURE — types and two string functions. No React, no I/O, so the canvas, the command layer, the
 * crop gesture and the modal editors can all speak it without any of them importing each other.
 */
import type { BaseSlot } from './_use-builder';

export type FrameRef =
  /** The uploaded image itself, edited from the tray. Not a placement. */
  | { kind: 'source'; photoId: string }
  /** One half of a page (or the single image of a double-spread). */
  | { kind: 'base'; blockKey: string; slot: BaseSlot; photoId: string }
  /** A floating photo frame — on a page block, or on a cover face (`blockKey: 'cover:back'`). */
  | { kind: 'overlay'; blockKey: string; overlayId: string; photoId: string };

/** True when the reference names a cover face rather than a content spread. */
export const isCoverFrame = (ref: FrameRef): boolean =>
  ref.kind !== 'source' && ref.blockKey.startsWith('cover:');

/**
 * A stable string identity for one frame, used to coalesce a gesture in the adjustment history.
 *
 * It deliberately does NOT include the photo id: dropping a different photo into the same frame
 * resets that frame's edit (see `assignBaseSlot` / `replaceOverlay`), so the frame is the thing
 * whose adjustments belong together, not the photo that happens to be in it.
 */
export function frameRefKey(ref: FrameRef): string {
  if (ref.kind === 'source') return `photo:${ref.photoId}`;
  if (ref.kind === 'base') return `${ref.blockKey}:${ref.slot}`;
  return `${ref.blockKey}:${ref.overlayId}`;
}

/** The `{ slot } | { overlayId }` shape `useBlocks.patchFrameEdit` / `frameEdit` take. */
export function frameSlotRef(ref: FrameRef): { slot?: BaseSlot; overlayId?: string } {
  return ref.kind === 'base' ? { slot: ref.slot } : ref.kind === 'overlay' ? { overlayId: ref.overlayId } : {};
}
