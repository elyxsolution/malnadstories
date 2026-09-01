import { CoverDesignFromConfig, SpineDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import type { CoverConfig } from '@/lib/builder/cover';

/**
 * THE ALBUM'S REAL COVER, for the face and bound edge of a `<Book>`.
 *
 * One place, three surfaces. The shelf, the album detail page and checkout all present an album as
 * a physical product, and all three used to show something that was not the customer's cover —
 * synthetic cloth artwork, or the cover TEMPLATE's thumbnail. They now show the same thing, from
 * the same source, because they call these two helpers.
 *
 * WHY THIS IS SHARED RATHER THAN REPEATED. The rendering itself is a one-line reuse of the
 * canonical components (`CoverDesignFromConfig` / `SpineDesign` — the same ones the builder, the
 * in-app preview, review mode and the PDF print route draw through), so there is no geometry, no
 * title rule and no colour logic here to duplicate. What IS worth centralising is the NULL RULE:
 * `normalizeCoverConfig` will cheerfully invent a default config for a missing one, so an album that
 * was never designed would look like it had a cover. Returning `undefined` for that case — in one
 * place — is what keeps `<Book>`'s own artwork as the honest fallback on every surface at once.
 *
 * `imageUrl` USED TO BE HARDCODED TO `null`, on the reasoning that resolving one presigned URL per
 * card would be an N+1 and that "no current cover uses an image". Both halves aged badly: a cover
 * photo is the single most visible thing on a cover, so an album whose front is a photograph drew
 * as a bare colour with its title on it — the reported "the front cover is not rendered as the
 * dashboard thumbnail". The N+1 was real, and is solved where it belongs: `resolveCoverFrontKeys`
 * answers the SAME priority chain for every album in three queries, so the caller passes a URL it
 * already has. Passing `null` still means "no artwork", and still renders background + text.
 *
 * `stickerUrlFor` is threaded for the same reason: a sticker placed on the cover is part of the
 * design, and a thumbnail that silently omits it is not the cover.
 */
export function albumCoverFace(
  cover: CoverConfig | null,
  title: string,
  imageUrl: string | null = null,
  stickerUrlFor?: (stickerId: string) => string | undefined,
) {
  if (!cover) return undefined;
  return (
    <CoverDesignFromConfig config={cover} title={title} imageUrl={imageUrl} stickerUrlFor={stickerUrlFor} />
  );
}

/**
 * The album's real spine. See `albumCoverFace` — same source, same NULL rule.
 *
 * WHY THIS DOES NOT TINT THE SPINE FROM THE COVER'S BACKGROUND: it does not need to, and it must
 * not. The spine owns its own colour now (`cover_config.spine.background`), and `SpineDesign`
 * paints exactly that — falling back to the house `#1e3a2f` when it is unset, which is also what
 * `coverBackgroundStyle(null)` gives a face with no background, so an undesigned album still shows
 * a matching face and binding. Deriving a tint here would disagree with the PRINTED spine, which
 * the print route, the in-app preview and review mode all draw through this same component. Print
 * fidelity wins over decoration.
 */
export function albumCoverSpine(cover: CoverConfig | null, title: string) {
  if (!cover) return undefined;
  return <SpineDesign config={cover} title={title} />;
}
