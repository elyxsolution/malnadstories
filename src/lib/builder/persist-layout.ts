/**
 * THE SERIALIZATION BOUNDARY — the one place blocks become a server payload, and therefore the
 * one place that must guarantee no temporary id ever leaves the browser.
 *
 * Extracted from the builder's save controller (unchanged in behaviour) so the creation wizard's
 * Auto Create can reuse it verbatim. Both surfaces now produce layouts that may reference photos
 * the server has never heard of — an optimistic `tmp_<taskId>` — and both must strip them the
 * same way. Two slightly different implementations of this rule is exactly the bug that would be
 * impossible to notice and expensive to find, so there is one function and both call it.
 *
 * Two passes, in order:
 *   1. RESOLVE — every id goes through the caller's mapping layer, so a photo that confirmed
 *      after it was placed is saved under its real id. This is the normal case.
 *   2. STRIP — an id that is still temporary refers to a photo the server does not have.
 *      `saveLayout` validates that every referenced photo belongs to the album, so sending one
 *      would fail the ENTIRE save. It is dropped from the payload instead (the slot saves empty
 *      — a legal state drafts already allow), and the caller tells the user.
 *
 * PURE: no React, no I/O. The caller supplies the resolver, which is what lets the builder use
 * its `idMap` ref and the wizard use the upload manager's task table without either growing a
 * second id-remapping system.
 */
import { trimBaseIds } from './model';

/** The minimum a caller must provide to resolve optimistic ids. Satisfied by `useIdMap`. */
export type LayoutIdResolver = {
  /** The canonical id for `id`: the real one if known, otherwise `id` unchanged. */
  resolve: (id: string) => string;
  /** True when `id` is a temp id with no known real id yet — must never be sent. */
  isUnresolvedTemp: (id: string) => boolean;
};

/**
 * Resolve every photo reference in `blocks`, dropping the ones that cannot be persisted yet.
 * Returns the payload-safe blocks plus how many placements were held back, so the caller can
 * keep the album dirty and say so.
 *
 * Typed STRUCTURALLY over "a thing with photoIds and overlays" rather than over `Block`, because
 * the two callers hand it different projections: the builder passes `api.serialize()` output
 * (already stripped of render-only keys) and the wizard passes freshly generated `Block[]`. The
 * generic returns whatever it was given, so neither caller loses fields it still needs.
 */
export function resolveLayoutForSave<
  O extends { photoId: string | null },
  B extends { photoIds: (string | null)[]; overlays: O[] },
>(blocks: readonly B[], ids: LayoutIdResolver): { blocks: B[]; stripped: number } {
  let stripped = 0;
  const out = blocks.map((b) => {
    // Base slots are POSITIONAL: an unresolvable id vacates its slot, exactly as an overlay keeps
    // its container. Pushing survivors into a fresh array used to compact the row, so a photo that
    // was still uploading on the LEFT page moved the right page's photo across on the next load.
    const photoIds = trimBaseIds(
      b.photoIds.map((id) => {
        if (!id) return null;
        const resolved = ids.resolve(id);
        if (ids.isUnresolvedTemp(resolved)) {
          stripped += 1;
          return null;
        }
        return resolved;
      }),
    );
    const overlays = b.overlays.map((o) => {
      if (!o.photoId) return o;
      const resolved = ids.resolve(o.photoId);
      if (ids.isUnresolvedTemp(resolved)) {
        stripped += 1;
        // Keep the CONTAINER (its geometry is the user's layout work) — only the photo
        // reference is dropped, exactly like an intentionally empty overlay slot.
        return { ...o, photoId: null };
      }
      return { ...o, photoId: resolved };
    });
    return { ...b, photoIds, overlays };
  });
  return { blocks: out, stripped };
}

/**
 * Record where each UNRESOLVED photo was meant to go, so the intent can be replayed once its
 * upload confirms (see `pending-placements`).
 *
 * The recorded slot is the index the photo was GENERATED into, and that index is now stable:
 * base slots are positional and a stripped id leaves a hole rather than collapsing the row, so
 * "slot 1" still means the right page after the strip. This used to have to count survivors and
 * guess the next free index, precisely because the model could not express "right slot filled,
 * left empty" — it can now, so the guess is gone.
 *
 * The recorded slot is still a PREFERENCE, not a promise: restoration falls back to any free slot
 * in the same block, which keeps the photo on its intended page even if a neighbour resolved first.
 */
export function pendingPlacementsFor(
  generated: readonly { photoIds: (string | null)[]; overlays: { photoId: string | null }[] }[],
  _persisted: readonly { photoIds: (string | null)[]; overlays: { photoId: string | null }[] }[],
  ids: LayoutIdResolver,
): { tempPhotoId: string; blockIndex: number; slot: { kind: 'base'; index: number } | { kind: 'overlay'; index: number } }[] {
  const out: {
    tempPhotoId: string;
    blockIndex: number;
    slot: { kind: 'base'; index: number } | { kind: 'overlay'; index: number };
  }[] = [];

  generated.forEach((block, blockIndex) => {
    // Base slots keep their index through the strip, so the generated position IS the target.
    block.photoIds.forEach((id, index) => {
      if (!id || !ids.isUnresolvedTemp(ids.resolve(id))) return;
      out.push({ tempPhotoId: id, blockIndex, slot: { kind: 'base', index } });
    });
    // Overlay containers are preserved 1:1 by the strip, so their indices are already stable.
    block.overlays.forEach((o, index) => {
      if (!o.photoId || !ids.isUnresolvedTemp(ids.resolve(o.photoId))) return;
      out.push({ tempPhotoId: o.photoId, blockIndex, slot: { kind: 'overlay', index } });
    });
  });

  return out;
}

/** Appended to a successful save when placements couldn't be persisted yet. */
export function strippedPhotoNote(n: number): string {
  return n === 0
    ? ''
    : ` ${n} photo${n === 1 ? '' : 's'} still uploading — save again once ${n === 1 ? 'it lands' : 'they land'} to keep ${n === 1 ? 'it' : 'them'} on the page.`;
}
