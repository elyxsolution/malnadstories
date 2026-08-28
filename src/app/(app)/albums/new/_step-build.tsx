'use client';

import { AlertCircle, ArrowRight, CheckCircle2, LayoutTemplate, Palette, RotateCw, Wand2 } from 'lucide-react';

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
  onAutoCreate,
  onChooseLayouts,
  onDesignMyself,
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
  onAutoCreate: () => void;
  onChooseLayouts: () => void;
  onDesignMyself: () => void;
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
      TWO COLUMNS. Photographs are the work of this screen and they need the width — a grid of
      thumbnails in a half-width column wastes both. The automated starting points are a short
      menu, so they move into a narrow rail on the right where they stay in view beside the
      upload area instead of sitting below it. Design Yourself stays in the main column, as a
      single wide row rather than a third card, because it is the option that needs no
      configuration and no statistics: it is one button.

      Below `lg` the rail drops beneath the main column and everything reads in the same order
      it always did — photographs, then how to build.
    */
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── MAIN COLUMN — photographs, then Design Yourself ────────────── */}
      <div className="min-w-0 space-y-8">
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

        <Uploader albumId={albumId} remaining={remaining} uploads={uploads} />

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
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] leading-relaxed text-muted-foreground">
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

        {/* ── DESIGN YOURSELF — stays in the main column, as one wide row ── */}
        <section className="border-t pt-8" aria-labelledby="design-yourself-heading">
          <MethodCard
            Icon={Palette}
            headingId="design-yourself-heading"
            title="Design Yourself"
            desc="Start with an empty album and place every photograph exactly where you want it."
            meta={[]}
            note="Full control, from a blank page."
            cta="Open builder"
            onClick={onDesignMyself}
            disabled={busy}
            row
          />
        </section>
      </div>

      {/* ── RIGHT RAIL — the automated starting points ──────────────────── */}
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start" aria-labelledby="build-heading">
        <div>
          <h2 id="build-heading" className="font-display text-lg font-semibold tracking-tight">
            How should we build it?
          </h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Pick a starting point — you can change every page afterwards in the builder.
          </p>
        </div>

        <MethodCard
          Icon={Wand2}
          title="Auto Create"
          badge="Fastest"
          primary
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

        {error && (
          <p role="alert" className="text-[13px] text-destructive">
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
 * `row` lays the same card out horizontally — icon, text, then the CTA on the right — for the
 * one option that lives in the wide main column. Same component, same props, same semantics;
 * only the arrangement differs, so there is no second card to keep in sync.
 */
function MethodCard({
  Icon,
  title,
  headingId,
  badge,
  desc,
  meta,
  note,
  cta,
  onClick,
  disabled,
  primary = false,
  row = false,
}: {
  Icon: typeof ArrowRight;
  title: string;
  headingId?: string;
  badge?: string;
  desc: string;
  meta: { k: string; v: string }[];
  note: string | null;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  row?: boolean;
}) {
  const shell = `rounded-2xl border p-5 transition-all duration-200 ease-glide sm:p-6 ${
    disabled ? 'opacity-60' : 'hover:-translate-y-1 hover:shadow-elevated'
  } ${primary ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/10' : 'bg-card'}`;

  const iconBadge = (
    <span
      className={`grid h-12 w-12 flex-none place-items-center rounded-xl ring-1 ${
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
      className={`h-11 text-[14px] ${row ? 'w-full sm:w-auto' : 'mt-5 w-full'} ${primary ? LUX_PRIMARY : ''}`}
    >
      <Icon /> {cta}
    </Button>
  );

  if (row) {
    return (
      <div className={`flex flex-col gap-4 sm:flex-row sm:items-center ${shell}`}>
        {iconBadge}
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-display text-xl font-semibold tracking-tight">
            {title}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
          {note && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
        </div>
        <div className="flex-none">{action}</div>
      </div>
    );
  }

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

        <h3 id={headingId} className="mt-4 font-display text-xl font-semibold tracking-tight">
          {title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>

        {meta.length > 0 && (
          <dl className="mt-4 space-y-1 border-t pt-3">
            {meta.map((m) => (
              <div key={m.k} className="flex items-center justify-between gap-2 text-[12px]">
                <dt className="text-muted-foreground">{m.k}</dt>
                <dd className="truncate font-medium tabular-nums text-foreground">{m.v}</dd>
              </div>
            ))}
          </dl>
        )}

        {note && <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
      </div>

      {action}
    </div>
  );
}
