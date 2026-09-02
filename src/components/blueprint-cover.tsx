import { CoverDesignFromConfig } from '@/app/(app)/albums/[id]/build/_cover-render';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';

/**
 * A BLUEPRINT, SHOWN AS ITS FRONT COVER.
 *
 * A blueprint is a complete design, and the thing a person recognises a design by is its cover —
 * so that is what represents it wherever one is listed. This replaces the previous representation,
 * a rasterised 2x2 montage of the first four INTERIOR spreads: an accurate picture of the page
 * layout, and the wrong answer to "which design is this?".
 *
 * NO NEW RENDERER, AND NO RENDERING PIPELINE AT ALL. It draws through `CoverDesignFromConfig` —
 * the same component the builder canvas, the in-app preview, the flipbook, review mode, the
 * dashboard shelf and the printer-ready cover export all draw through — so a blueprint's cover in
 * a gallery is, by construction, the cover a customer receives. That component is pure: it takes a
 * `CoverConfig` and a title, and needs no album, no signed-in user, no photo and no database read.
 * Which is precisely why no Chromium screenshot, no worker job, no R2 object and no `thumb_key` is
 * involved in showing one.
 *
 * `imageUrl` IS ALWAYS NULL, and that is a property of the data rather than a limitation here: a
 * blueprint cover is stripped of `photoId` by `blueprintCoverFromConfig`, because a photo id names
 * one customer's private upload and a blueprint is global. A blueprint cover is therefore always
 * background + typography + stickers, all of which render from the config itself.
 *
 * `stickerUrlFor` is optional and resolved by the CALLER (server-side, by id, via
 * `resolveStickerUrls`) exactly as every other surface resolves placed stickers. Omitting it
 * degrades to the same behaviour as a since-deleted sticker: the rest of the cover still draws.
 */
export function BlueprintCover({
  cover,
  name,
  stickerUrlFor,
}: {
  /** The blueprint's own cover design, or null/undefined when it defines none. */
  cover: CoverConfig | null | undefined;
  /** Shown as the cover's title line — a blueprint has no album title of its own. */
  name: string;
  stickerUrlFor?: (stickerId: string) => string | undefined;
}) {
  // The NULL RULE, matching `albumCoverFace`: `normalizeCoverConfig` will happily invent a complete
  // default config for a missing one, which would make a blueprint that has no cover look like it
  // had one. Returning null instead lets each caller show its own honest "no cover yet" state.
  if (!cover) return null;
  return (
    <CoverDesignFromConfig
      config={normalizeCoverConfig(cover as Parameters<typeof normalizeCoverConfig>[0])}
      title={name}
      imageUrl={null}
      stickerUrlFor={stickerUrlFor}
    />
  );
}

export default BlueprintCover;
