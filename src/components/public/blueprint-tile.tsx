import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import BlueprintCover from '@/components/blueprint-cover';
import type { PublicBlueprint } from '@/lib/blueprints/public';

/**
 * A DESIGN, PRESENTED AS AN OBJECT — the single customer-facing Blueprint tile.
 *
 * ONE COMPONENT, THREE VARIANTS, used by the Home shelf, the Stories gallery and anything later.
 * The alternative — a card per surface — is how four slightly different designs for the same
 * concept end up in a codebase, and how the cover-rendering call gets copied four times.
 *
 * THE COVER CARRIES THE PAGE. There is no border, no card chrome, no shadow box, no badge row and
 * no metadata table: a book on a shelf is recognised by its cover, so the cover is given the
 * space and everything else is set quietly beneath it. The tile's only decoration is a soft
 * shadow under the cover itself, which reads as the book sitting on a surface rather than as a UI
 * card floating on one.
 *
 * IT IS A SERVER COMPONENT. Nothing here needs state: the hover treatment is CSS (`.ms-lift` +
 * `group/tile`), so a gallery of thirty designs hydrates nothing at all.
 *
 * ⚠️ TOUCH: the cover is rendered inside a plain `<Link>` with NO drag handlers, NO pointer
 * capture and NO `touch-action` override, so a vertical swipe that begins on a cover scrolls the
 * page exactly as it would anywhere else. `draggable={false}` is set on the wrapper because the
 * native image-drag gesture is the one thing that CAN steal a press here, and a design tile is
 * not a draggable object.
 */

export type BlueprintTileVariant = 'featured' | 'gallery' | 'compact';

/**
 * WHERE "USE DESIGN" GOES — stated once, here.
 *
 * PHASE 1 SCOPE: this is the destination CONTRACT, not the authentication flow. It points at the
 * real album-creation entry and names the chosen design in the URL, which is a value Phase 2 can
 * carry through a login round trip. Phase 1 deliberately does NOT add the `next`/return-to
 * plumbing, the signed-in navbar, or any middleware change.
 *
 * PHASE 2 CONTRACT: `/albums/new` is auth-guarded by `(app)/layout.tsx`, so a signed-out visitor
 * is redirected to `/login` today and the `?design=` parameter is lost. Phase 2 closes that by
 * capturing the intended path (middleware already forwards `x-pathname`) and honouring a
 * validated `next` in `signIn`, the OAuth `redirectTo` and `middleware.ts:151` — at which point
 * this href starts working end to end with no change to this component.
 */
export function designHref(id: string): string {
  return `/albums/new?design=${encodeURIComponent(id)}`;
}

export default function BlueprintTile({
  blueprint: b,
  stickerUrls,
  variant = 'gallery',
}: {
  blueprint: PublicBlueprint;
  stickerUrls: Record<string, string>;
  variant?: BlueprintTileVariant;
}) {
  const stickerUrlFor = (id: string) => stickerUrls[id];
  const href = designHref(b.id);

  const nameSize =
    variant === 'featured'
      ? 'text-[22px] sm:text-2xl'
      : variant === 'compact'
        ? 'text-[15px]'
        : 'text-lg';

  return (
    <article className="group/tile">
      <Link
        href={href}
        draggable={false}
        aria-label={`Use the ${b.name} design`}
        className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        {/*
          A FIXED 3:4 BOX — a book's proportion, and the reason this page has no layout shift.
          The cover is drawn from config rather than loaded as an image, so the box is filled on
          first paint with nothing to arrive later. `overflow-hidden` clips the cover's own art;
          `bg-secondary` is what shows for a design that has no cover yet.
        */}
        <div className="ms-lift relative aspect-[3/4] w-full overflow-hidden bg-secondary shadow-[0_1px_2px_rgb(16_24_20/0.06),0_18px_40px_-24px_rgb(16_24_20/0.45)] group-hover/tile:shadow-[0_2px_6px_rgb(16_24_20/0.08),0_28px_56px_-24px_rgb(16_24_20/0.55)]">
          {b.cover ? (
            <BlueprintCover cover={b.cover} name={b.name} stickerUrlFor={stickerUrlFor} />
          ) : (
            /*
              NO COVER YET — a typographic stand-in, never a placeholder icon and never the old
              interior montage. A design with no cover is rare and temporary; it should still look
              like a book on the shelf rather than a broken tile.
            */
            <div className="flex h-full w-full flex-col items-center justify-center bg-primary px-6 text-center text-primary-foreground">
              <span className="font-display text-xl leading-tight">{b.name}</span>
              <span className="mt-3 block h-px w-10 bg-gold-pale/60" />
              <span className="mt-3 text-[10px] uppercase tracking-[0.2em] text-primary-foreground/60">
                {b.categoryLabel}
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Caption — quiet, and outside the cover so nothing is printed over the artwork. */}
      <div className={variant === 'compact' ? 'mt-3' : 'mt-4'}>
        <h3 className={`font-display font-normal leading-snug tracking-tight text-primary ${nameSize}`}>
          <Link href={href} className="transition-colors hover:text-gold focus-visible:text-gold focus-visible:outline-none">
            {b.name}
          </Link>
        </h3>

        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {b.categoryLabel}
          <span aria-hidden> · </span>
          <span className="tabular-nums">{b.pageCount}</span> pages
          <span aria-hidden> · </span>
          holds <span className="tabular-nums">{b.slotCount}</span>
        </p>

        {variant === 'featured' && b.description && (
          <p className="mt-3 max-w-sm text-sm font-light leading-relaxed text-muted-foreground">{b.description}</p>
        )}

        {variant !== 'compact' && (
          <Link
            href={href}
            className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary transition-all duration-150 ease-glide hover:gap-2.5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Use this design
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    </article>
  );
}
