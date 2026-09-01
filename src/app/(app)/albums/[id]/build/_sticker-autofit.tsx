'use client';

import { useEffect, useState } from 'react';
import { stickerFitBox } from '@/lib/builder/sticker-fit';
import type { Rect, StickerElement } from '@/lib/builder/model';

/**
 * STICKER AUTO-FIT, the measuring half. Renders nothing.
 *
 * The decisions live in `lib/builder/sticker-fit.ts` (pure); this supplies the one fact that
 * module cannot know on its own — the artwork's intrinsic aspect ratio — and reports the tightened
 * box. It is the direct counterpart of `_text-autofit`, in shape and in contract:
 *
 *   mounted only on an EDITING canvas · measures the real content · reports a box ·
 *   the host applies it as an AMEND (a correction, not a new undo entry).
 *
 * ── WHY THE ASPECT IS CACHED MODULE-WIDE ───────────────────────────────────────────────────
 *
 * A sticker's intrinsic size is a property of the ASSET, not of the placement, and the same
 * artwork is routinely placed several times and revisited across pages. Measuring it once per URL
 * and remembering it means turning pages costs nothing, and a page with twelve copies of one
 * sticker issues one decode rather than twelve. The cache is keyed by the resolved URL and holds a
 * number, so it cannot go stale in a way that matters — a presigned URL that expires simply
 * produces a new key.
 *
 * ── WHY THERE IS NO "SUPPRESS WHILE RESIZING" FLAG ─────────────────────────────────────────
 *
 * Text auto-fit needs one, because a text box's aspect is the user's to choose and a fit mid-drag
 * would fight the pointer. A sticker's is not: the canvases lock a sticker's resize to the
 * artwork's aspect (`stickerAspectRatio` through `Movable`'s existing `keepSquare`/`squareRatio`),
 * so a resize CANNOT change the box aspect and `stickerFitBox` returns `null` throughout the
 * gesture. A move changes only x/y, likewise. The fit therefore has nothing to fight, and adding a
 * flag would be describing a conflict that cannot happen.
 */

/** url → naturalWidth / naturalHeight. Populated once per asset, for the life of the page. */
const ASPECTS = new Map<string, number>();

/**
 * Resolve the intrinsic aspect of every sticker URL on this surface.
 *
 * Returns a map that grows as images decode; a URL that has not resolved yet is simply absent, and
 * callers do nothing for it — an unmeasured sticker keeps the box it has, which is exactly the
 * behaviour that existed before this hook.
 */
export function useStickerAspects(urls: readonly (string | undefined)[]): Map<string, number> {
  const [, bump] = useState(0);
  const key = urls.filter(Boolean).join(' ');

  useEffect(() => {
    let alive = true;
    const pending = Array.from(new Set(urls.filter((u): u is string => !!u && !ASPECTS.has(u))));
    if (pending.length === 0) return;
    let settled = 0;
    for (const url of pending) {
      const img = new Image();
      const done = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          ASPECTS.set(url, img.naturalWidth / img.naturalHeight);
        }
        settled += 1;
        // One re-render once the batch has settled, rather than one per image.
        if (alive && settled === pending.length) bump((n) => n + 1);
      };
      img.onload = done;
      // A broken URL settles too: it must never leave the batch permanently pending.
      img.onerror = done;
      img.src = url;
    }
    return () => {
      alive = false;
    };
    // `key` is the identity of the URL set; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ASPECTS;
}

/**
 * Tighten every sticker whose box does not match its artwork, and hand back the measured aspects
 * so the caller can lock each sticker's RESIZE to the same ratio.
 *
 * `containerAspect` is the host surface's width / height in PIXELS (the open pair, or one cover
 * face) — the space the element's 0..1 box is normalized to.
 *
 * A LOCKED sticker is skipped: locking exists to freeze geometry, and a correction is still a
 * change to it.
 */
export function useStickerBoxFit({
  stickers,
  urlFor,
  containerAspect,
  onFit,
}: {
  stickers: readonly StickerElement[];
  urlFor: (stickerId: string) => string | undefined;
  containerAspect: number;
  /** Receives the fitted box. Expected to be an AMEND — a correction, not a new undo entry. */
  onFit: (id: string, box: Rect) => void;
}): Map<string, number> {
  const aspects = useStickerAspects(stickers.map((s) => urlFor(s.stickerId)));

  // A signature over everything the fit reads, so it re-runs when a sticker is added, moved,
  // resized or newly measured — and not otherwise.
  const signature = stickers
    .map((s) => {
      const url = urlFor(s.stickerId);
      return `${s.id}:${s.x},${s.y},${s.w},${s.h}:${s.locked ? 1 : 0}:${url ? (aspects.get(url) ?? '') : ''}`;
    })
    .join('|');

  useEffect(() => {
    if (!(containerAspect > 0)) return;
    for (const s of stickers) {
      if (s.locked) continue;
      const url = urlFor(s.stickerId);
      const aspect = url ? aspects.get(url) : undefined;
      if (!aspect) continue;
      const box = stickerFitBox(s, aspect, containerAspect);
      if (box) onFit(s.id, box);
    }
    // Keyed on the signature, which contains the geometry this writes — so a fit DOES change the
    // key. What terminates it is that the fit is idempotent: `stickerFitBox` returns null once the
    // box matches the artwork, so the next pass does nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, containerAspect]);

  return aspects;
}
