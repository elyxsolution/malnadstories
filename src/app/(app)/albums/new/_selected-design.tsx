'use client';

import { AlertCircle, Check, X } from 'lucide-react';
import BlueprintCover from '@/components/blueprint-cover';
import { categoryLabel } from '@/lib/templates/model';
import type { WizardBlueprint } from './_wizard';

/**
 * THE DESIGN THE CUSTOMER ARRIVED WITH — the visible proof it survived signing in.
 *
 * A visitor who pressed "Use this design" on the public gallery may have gone through a login or
 * a signup and a verification email before reaching this screen. Landing on an album wizard that
 * looks identical to the blank one is indistinguishable from having lost the choice, so the
 * design is shown, by its OWN COVER, drawn through the same `BlueprintCover` the gallery drew.
 *
 * It is a STATEMENT, not a control: the only interaction is dismissing it, which returns the
 * customer to an ordinary blank start. Everything else about the design — its page count, its
 * cover, its layout — is applied by the wizard through the existing server paths.
 *
 * The three states are the three things that can actually be true when this screen loads:
 *   · `design`      — chosen, matched, and about to be applied.
 *   · `mismatch`    — chosen, but the customer has since picked a different page count. The
 *                     design cannot be applied to a book of another length, so it is held aside
 *                     with a one-press way back rather than silently dropped.
 *   · `unavailable` — the id no longer resolves to an active design. Said plainly; creation
 *                     continues.
 */
export default function SelectedDesign({
  design,
  stickerUrls,
  mismatchPageCount,
  onRestorePageCount,
  onClear,
}: {
  design: WizardBlueprint | null;
  stickerUrls: Record<string, string>;
  /** Set when a design was chosen but the current page count no longer matches it. */
  mismatchPageCount: number | null;
  onRestorePageCount: () => void;
  onClear: () => void;
}) {
  if (!design) return null;
  const mismatch = mismatchPageCount !== null;

  return (
    <aside
      className="animate-rise mb-6 flex items-center gap-4 rounded-2xl border bg-card p-3 shadow-xs sm:gap-5 sm:p-4"
      aria-label="Selected design"
    >
      {/*
        THE COVER, SMALL — 3:4, so it is recognisably the same object the gallery showed.

        A design with no cover of its own falls back to the SAME typographic stand-in the public
        tile uses (name · rule · category on the brand ground) rather than to a blank rectangle.
        Showing a green book on /stories and an empty card here would read as "something was lost
        on the way in" — which is the one impression this whole banner exists to prevent.
      */}
      <div className="aspect-[3/4] w-14 flex-none overflow-hidden rounded-md bg-secondary shadow-xs sm:w-16">
        {design.cover ? (
          <BlueprintCover cover={design.cover} name={design.name} stickerUrlFor={(id) => stickerUrls[id]} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-primary px-1.5 text-center text-primary-foreground">
            <span className="font-display text-[11px] leading-tight">{design.name}</span>
            <span className="mt-1 block h-px w-4 bg-gold-pale/60" />
            <span className="mt-1 text-[6px] uppercase tracking-[0.16em] text-primary-foreground/60">
              {categoryLabel(design.category as Parameters<typeof categoryLabel>[0])}
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {mismatch ? (
            <AlertCircle className="h-3.5 w-3.5 text-warning" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          )}
          {mismatch ? 'Design on hold' : 'Your design'}
        </p>
        <p className="mt-1 truncate font-display text-[17px] font-semibold tracking-tight">{design.name}</p>

        {mismatch ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {design.name} is a <span className="tabular-nums">{design.pageCount}</span>-page album.{' '}
            <button
              type="button"
              onClick={onRestorePageCount}
              className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Switch back to {design.pageCount} pages
            </button>{' '}
            to use it.
          </p>
        ) : (
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {/* Only claim a cover when the design actually carries one — a blueprint may define a
                layout and no cover, in which case the album starts on the default cover instead. */}
            {design.cover ? 'Its cover and ' : 'Its '}
            <span className="tabular-nums">{design.pageCount}</span>-page layout {design.cover ? 'are' : 'is'} ready
            — you can change anything afterwards in the builder.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        aria-label={`Start without the ${design.name} design`}
        className="grid h-11 w-11 flex-none place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
