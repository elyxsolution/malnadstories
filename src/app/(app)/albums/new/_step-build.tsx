'use client';

import { AlertCircle, ArrowRight, CheckCircle2, LayoutTemplate, RotateCw, Sparkles, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { Photo } from '@/lib/builder/photo';
import type { UploadManagerApi } from '@/lib/uploads';
import { layoutInputs } from '../[id]/build/_use-optimistic-layout';
import Uploader from '../[id]/build/_uploader';
import UploadBadge, { stateOpacityClass } from '../[id]/build/_upload-badge';
import { photoUiState } from '../[id]/build/_photo-state';
import type { WizardBlueprint } from './_wizard';

/**
 * STEP 2 — UPLOAD & BUILD.
 *
 * The old flow put uploading and choosing-how-to-build on two screens separated by a
 * Continue button, which meant the customer had to declare "I am finished uploading"
 * before they were offered anything to do. They are the same moment: photos arrive, and
 * the album can be built. So they share a screen.
 *
 * THE BUILD CHOICE IS THE POINT OF THIS PAGE, and the layout now says so. Uploading is a
 * compact utility strip at the top — dropzone, batch progress, one status line, the grid —
 * while the three build methods are full-size action cards below it, the largest and only
 * accented things on the page. That is the inverse of the first pass, where a tall upload
 * hero pushed three small buttons into a side rail.
 *
 * Nothing here waits on the backend. Uploads keep running underneath the cards, and the
 * copy says plainly which photos a machine-built layout can actually reach.
 */

export default function StepBuild({
  albumId,
  cap,
  photos,
  uploads,
  blueprints,
  autoTarget,
  categoryCount,
  featuredCount,
  busy,
  error,
  uploadAnchorRef,
  selectedDesign = null,
  onAutoCreate,
  onChooseLayouts,
  onDesignMyself,
  onUseDesign,
}: {
  albumId: string;
  cap: number;
  photos: Photo[];
  uploads: UploadManagerApi;
  /** Active blueprints matching this album's page count. */
  blueprints: WizardBlueprint[];
  /** The blueprint Auto Create will actually use, or null when none match. */
  autoTarget: WizardBlueprint | null;
  categoryCount: number;
  featuredCount: number;
  busy: boolean;
  error: string | null;
  /** Scroll target for "Upload photos" in the Auto Create warning. */
  uploadAnchorRef: React.RefObject<HTMLDivElement>;
  /**
   * THE DESIGN THE CUSTOMER ARRIVED WITH (Phase 2), when there is one and it matches this
   * album's length. Its presence adds a card at the top of the rail and demotes Auto Create
   * from primary — a customer who already chose a design on the public site should not have to
   * hunt for it among three generic starting points.
   */
  selectedDesign?: WizardBlueprint | null;
  onAutoCreate: () => void;
  onChooseLayouts: () => void;
  onDesignMyself: () => void;
  onUseDesign?: () => void;
}) {
  const ready = photos.filter((p) => p.status === 'ready').length;
  const processing = photos.filter((p) => p.status === 'pending').length;
  const rejected = photos.filter((p) => p.status === 'rejected').length;
  /**
   * What Auto Create can actually place (Phase 4) — photos with a reliable shape, whether or not
   * the worker has finished with them. Counted with the SAME projection Auto Create runs on, so
   * the number on the card is the number that gets placed.
   */
  const usableCount = layoutInputs(photos).length;
  const unusable = Math.max(0, photos.length - usableCount);
  const remaining = Math.max(0, cap - photos.length);
  const batch = uploads.activeSessions;

  return (
    /*
      TWO COLUMNS, EACH ONE A DECISION.

      LEFT is everything about the photographs — the heading, the count, the dropzone, the grid —
      and then CONTINUE, because "I am done here, open the builder" is the end of that column's
      thought rather than an item in the menu on the right.

      RIGHT is how the album gets built for you, and its two starting points sit SIDE BY SIDE.
      They are alternatives to each other, and a vertical stack reads as a sequence: do this,
      then that. Two columns say "one or the other", which is what they are. It also stops the
      pair running past the fold on a laptop.

      The split is roughly 52/48 rather than an even half: the photograph grid is the only thing
      on this screen whose height depends on content, so it takes the wider side.

      Below `lg` the two columns become one and everything reads in the order it always did —
      photographs, CONTINUE, then how to build.
    */
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
      {/* ── LEFT COLUMN — the photographs, then CONTINUE ───────────────── */}
      <div className="min-w-0">
      {/* ── UPLOAD — compact utility strip ─────────────────────────────── */}
      <section ref={uploadAnchorRef} className="scroll-mt-28 space-y-3" aria-labelledby="upload-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="upload-heading" className="font-display text-lg font-semibold tracking-tight">
            Your photographs
          </h2>
          <p className="text-[12px] tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{photos.length}</span> of {cap} · {remaining}{' '}
            {remaining === 1 ? 'slot' : 'slots'} left
          </p>
        </div>

        {/* This screen exists to get photographs in, so the dropzone renders at its
            `comfortable` scale here — same component, same handlers, same wording, roughly twice
            the height with a much larger primary label and icon. The builder tray keeps the
            compact row, where the rail is narrow and the grid owns the space. */}
        <Uploader albumId={albumId} remaining={remaining} uploads={uploads} size="comfortable" />

        {/* Batch progress — one bar per pick, so a 60-file drop reads as one thing. Bytes are
            half the bar and worker time the other half, so it keeps moving after upload lands. */}
        {batch.length > 0 && (
          <ul className="space-y-1.5">
            {batch.map((s) => (
              <li key={s.id} className="rounded-lg border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <InlineLoader />
                    <span className="truncate">
                      {s.completed} of {s.total} added
                    </span>
                  </span>
                  <span className="flex-none tabular-nums text-muted-foreground">{Math.round(s.progress * 100)}%</span>
                </div>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className="block h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-glide"
                    style={{ transform: `scaleX(${s.progress})` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* One status line, not three counters. */}
        {photos.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              {ready} ready
            </span>
            {processing > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <InlineLoader /> {processing} processing
              </span>
            )}
            {rejected > 0 && (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {rejected} couldn’t be used
              </span>
            )}
            {uploads.stats.retryable > 0 && (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {uploads.stats.retryable} failed to upload
              </span>
            )}
          </div>
        )}

        {photos.length === 0 ? (
          /* THE PHOTOGRAPH SHELF, empty. Same dashed panel, given the height the filled grid
             occupies and a readable type size, so the section no longer collapses to one thin
             line before the first upload. Wording unchanged. */
          <p className="flex min-h-[184px] items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center text-[15px] leading-relaxed text-muted-foreground">
            No photographs yet — add up to {cap}. You can also design the pages first and upload from
            inside the builder.
          </p>
        ) : (
          /* The grid stays comfortable: tiles are unchanged in size, there are simply more
             columns available now that the section around them is tighter.

             R3: only the BASE (mobile) column count changed — `sm:` and up are untouched, so
             every tablet and desktop width renders exactly as before. Four columns measured
             64×64 at 320px and 78×78 at 375px, too small to tell one photograph from another
             and cramped for the Retry overlay. Three columns give ~88px at 320 and ~106px at
             375; the fourth column returns at 420px where there is room for it. */
          <ul className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10">
            {photos.map((p) => {
              const src = resolvePhotoUrl(p, 'thumb');
              const task = uploads.taskByTempPhotoId.get(p.id);
              const state = photoUiState(p, task);
              const canRetry = state === 'failed' && task && task.photoId === null;

              return (
                <li key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={p.filename}
                      loading="lazy"
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${stateOpacityClass(state)}`}
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                      <InlineLoader />
                    </span>
                  )}

                  {canRetry ? (
                    <button
                      type="button"
                      onClick={() => uploads.retry(task.id)}
                      className="absolute inset-0 grid place-items-center gap-1 bg-background/90 px-1.5 text-center text-[10px] font-medium leading-tight text-destructive transition-transform duration-100 ease-glide active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <RotateCw className="mx-auto h-3.5 w-3.5" />
                      Retry
                    </button>
                  ) : (
                    state !== 'ready' && (
                      <span className="absolute left-1.5 top-1.5">
                        <UploadBadge state={state} progress={task?.progress} size="compact" />
                      </span>
                    )
                  )}

                  {state === 'uploading' && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/20">
                      <span
                        className="block h-full origin-left bg-primary transition-transform duration-200 ease-glide"
                        style={{ transform: `scaleX(${(task?.progress ?? 0) / 100})` }}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        ── CONTINUE — the manual route, and the left column's terminal action ─────────────
        It replaced the old "Design Yourself" card, which was a fourth option dressed as the
        other three: same shell, same statistics slot, same outline button. It is not a fourth
        option. Auto Create and Choose Layout hand the album to something that lays it out FOR
        you; this one just opens the builder — so it belongs under the photographs, as the end of
        that column's thought, not in the menu of automated starting points beside it.

        THE WHOLE BLOCK IS THE BUTTON. One target, and it fires the SAME `onDesignMyself` the old
        "Open builder" button fired — handler, route and album state untouched. The green is
        `LUX_PRIMARY`, the project's existing crafted forest CTA surface, so this wears the brand
        green every other primary action already wears rather than a colour invented for one block.
      */}
      <button
        type="button"
        onClick={onDesignMyself}
        disabled={busy}
        className={`group/continue mt-6 block w-full rounded-2xl px-6 py-8 text-center transition-all duration-200 ease-glide hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 ${LUX_PRIMARY}`}
      >
        <span className="flex items-center justify-center gap-3 sm:gap-4">
          {/* An h3, so it belongs to the central heading typography system like every other
              title on this screen rather than being a one-off label with a hand-picked size. */}
          <h3 className="text-[clamp(2rem,4.4vw,2.5rem)] font-semibold uppercase leading-none tracking-[0.06em]">
            CONTINUE
          </h3>
          <ArrowRight className="h-7 w-7 flex-none transition-transform duration-200 ease-glide group-hover/continue:translate-x-1 motion-reduce:transition-none sm:h-8 sm:w-8" />
        </span>
        {/* Supporting text: says what CONTINUE actually does. Deliberately quieter — several
            steps down in size and held off full opacity, so the word above it stays the loud
            thing and the block still reads as one statement rather than two. */}
        <span className="mt-2.5 block text-[15px] font-light leading-relaxed text-primary-foreground/75">
          to edit album builder manually
        </span>
      </button>
      </div>

      {/* ── RIGHT COLUMN — the two automated starting points, side by side ── */}
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start" aria-labelledby="build-heading">
        <div>
          <h2 id="build-heading" className="font-display text-xl font-semibold tracking-tight">
            How should we build it?
          </h2>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            Pick a starting point — you can change every page afterwards in the builder.
          </p>
        </div>

        {/*
          THE PAIR. `items-stretch` is the grid default, and each card is a flex column whose
          content block is `flex-1`, so the two buttons line up along one baseline however
          differently the descriptions and statistics wrap. Below `sm` they stack, because two
          of these side by side on a phone would be two cramped cards rather than a choice.

          A design the customer arrived with spans BOTH columns above the pair: it is the
          recommended answer, not a third alternative of equal weight.
        */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">

        {/*
          YOUR DESIGN — first in the rail, and the only accented card when it exists. It reuses
          `MethodCard` rather than introducing a fourth card style, so the rail stays one list of
          starting points with a clear first choice rather than a special case bolted on top.
        */}
        {selectedDesign && onUseDesign && (
          <MethodCard
            className="sm:col-span-2"
            Icon={Sparkles}
            title={selectedDesign.name}
            badge="Your design"
            primary
            desc="Use the design you chose — its cover is already applied, and this lays out its pages."
            meta={[
              { k: 'Pages', v: `${selectedDesign.pageCount}` },
              { k: 'Holds', v: `${selectedDesign.slotCount}` },
              { k: 'Will place', v: `${usableCount}` },
            ]}
            note={usableCount === 0 ? 'You can open the builder now and add photographs as they upload.' : null}
            cta="Use this design"
            onClick={onUseDesign}
            disabled={busy}
          />
        )}

        <MethodCard
          Icon={Wand2}
          title="Auto Create"
          badge="Fastest"
          primary={!selectedDesign}
          desc={
            autoTarget
              ? `Generate a complete album from the “${autoTarget.name}” layout, with your photos placed for you.`
              : 'Generate a complete album automatically, with your photos placed for you.'
          }
          meta={
            autoTarget
              ? [
                  { k: 'Layout', v: autoTarget.name },
                  { k: 'Holds', v: `${autoTarget.slotCount}` },
                  { k: 'Will place', v: `${usableCount}` },
                ]
              : [{ k: 'Will place', v: `${usableCount}` }]
          }
          note={
            unusable > 0
              ? `${unusable} can’t be placed automatically — those stay in your tray to place yourself.`
              : null
          }
          cta="Auto Create"
          onClick={onAutoCreate}
          disabled={busy}
        />

        <MethodCard
          Icon={LayoutTemplate}
          title="Choose Layout"
          desc="Browse curated album layouts and pick the style you like, then fill it while you build."
          meta={
            blueprints.length > 0
              ? [
                  { k: 'Layouts', v: `${blueprints.length}` },
                  { k: 'Categories', v: `${categoryCount}` },
                  { k: 'Featured', v: `${featuredCount}` },
                ]
              : []
          }
          note={blueprints.length === 0 ? 'No layouts for this album size yet.' : null}
          cta="Browse layouts"
          onClick={onChooseLayouts}
          disabled={busy || blueprints.length === 0}
        />

        </div>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-destructive">
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}

/**
 * One build option, as an action card rather than a button with a label. The primary card is
 * the only one carrying the accent, so stacking them in the rail keeps the hierarchy.
 *
 * COMPACT: the shell, the icon well and every vertical step were tightened so the pair takes less
 * room in the rail. Nothing typographic moved — title, description, statistics and button label
 * are all at the sizes they were; only the space around them is smaller, which is what makes the
 * cards read as condensed rather than shrunken.
 *
 * The `row` variant is gone with its only caller (the old Design Yourself card). Every card this
 * component renders now lives in the rail, so there is one arrangement.
 */
function MethodCard({
  Icon,
  title,
  badge,
  desc,
  meta,
  note,
  cta,
  onClick,
  disabled,
  primary = false,
  className = '',
}: {
  Icon: typeof ArrowRight;
  title: string;
  badge?: string;
  desc: string;
  meta: { k: string; v: string }[];
  note: string | null;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Grid placement only — the pair sit in one column each, a chosen design spans both. */
  className?: string;
}) {
  const shell = `rounded-2xl border p-4 transition-all duration-200 ease-glide sm:p-5 ${className} ${
    disabled ? 'opacity-60' : 'hover:-translate-y-1 hover:shadow-elevated'
  } ${primary ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/10' : 'bg-card'}`;

  const iconBadge = (
    <span
      className={`grid h-10 w-10 flex-none place-items-center rounded-xl ring-1 ${
        primary ? 'bg-primary text-primary-foreground ring-primary/20' : 'bg-primary/[0.07] text-primary ring-primary/15'
      }`}
    >
      <Icon className="h-5 w-5" />
    </span>
  );

  const action = (
    <Button
      onClick={onClick}
      disabled={disabled}
      size="lg"
      variant={primary ? 'default' : 'outline'}
      className={`mt-4 h-10 w-full text-[14px] ${primary ? LUX_PRIMARY : ''}`}
    >
      <Icon /> {cta}
    </Button>
  );

  return (
    <div className={`flex flex-col ${shell}`}>
      {/* flex-1 on the content block keeps the CTAs aligned across cards whose
          descriptions and stat lists differ in height. */}
      <div className="flex-1">
        <div className="flex items-start justify-between gap-3">
          {iconBadge}
          {badge && (
            <span className="rounded-full bg-primary/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {badge}
            </span>
          )}
        </div>

        <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>

        {meta.length > 0 && (
          <dl className="mt-3 space-y-0.5 border-t pt-2.5">
            {meta.map((m) => (
              <div key={m.k} className="flex items-center justify-between gap-2 text-[12px]">
                <dt className="text-muted-foreground">{m.k}</dt>
                <dd className="truncate font-medium tabular-nums text-foreground">{m.v}</dd>
              </div>
            ))}
          </dl>
        )}

        {note && <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
      </div>

      {action}
    </div>
  );
}
