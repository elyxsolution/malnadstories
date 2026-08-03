'use client';

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Dices,
  ImageIcon,
  LayoutTemplate,
  RotateCw,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { Photo } from '@/lib/builder/photo';
import type { UploadManagerApi } from '@/lib/uploads';
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
 * UPLOAD owns the main column, BUILD owns a rail that stays in view while the grid
 * scrolls — the reason it is a rail and not a band underneath is that a 100-photo grid
 * would otherwise push every action off-screen exactly when the user wants one. On
 * mobile the rail becomes the section below, in the same reading order.
 *
 * Nothing here waits on the backend. The three actions are live from the moment the
 * album exists, uploads keep running underneath them, and the copy says plainly which
 * photos a machine-built layout can reach.
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
  onAutoCreate: () => void;
  onChooseLayouts: () => void;
  onDesignMyself: () => void;
}) {
  const ready = photos.filter((p) => p.status === 'ready').length;
  const processing = photos.filter((p) => p.status === 'pending').length;
  const rejected = photos.filter((p) => p.status === 'rejected').length;
  const remaining = Math.max(0, cap - photos.length);
  const batch = uploads.activeSessions;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
      {/* ── UPLOAD ─────────────────────────────────────────────────────── */}
      <section className="min-w-0 space-y-5" aria-labelledby="upload-heading">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              id="upload-heading"
              className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-[2rem]"
            >
              Add your photographs.
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
              Drop them in — you can start building while they upload.
            </p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl font-semibold leading-none tabular-nums">
              {photos.length}
              <span className="text-lg text-muted-foreground/60"> / {cap}</span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {remaining} {remaining === 1 ? 'slot' : 'slots'} left
            </div>
          </div>
        </header>

        <Uploader albumId={albumId} remaining={remaining} uploads={uploads} />

        {/* Batch progress — one bar per pick, so a 60-file drop reads as one thing.
            Bytes are half the bar and worker time the other half, so it keeps moving
            after the upload lands instead of parking at 100%. */}
        {batch.length > 0 && (
          <ul className="space-y-2">
            {batch.map((s) => (
              <li key={s.id} className="rounded-xl border bg-card px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <InlineLoader />
                    <span className="truncate">
                      {s.completed} of {s.total} added
                    </span>
                  </span>
                  <span className="flex-none tabular-nums text-muted-foreground">
                    {Math.round(s.progress * 100)}%
                  </span>
                </div>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-secondary">
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
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
          <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </span>
            <p className="mt-3 font-display text-lg font-semibold tracking-tight">No photographs yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              Add up to {cap}. Or skip this for now and design the pages first — you can upload
              from inside the builder at any time.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
            {photos.map((p) => {
              const src = resolvePhotoUrl(p, 'thumb');
              const task = uploads.taskByTempPhotoId.get(p.id);
              const state = photoUiState(p, task);
              const canRetry = state === 'failed' && task && task.photoId === null;

              return (
                <li
                  key={p.id}
                  className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                >
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

      {/* ── BUILD ──────────────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-24 lg:self-start" aria-labelledby="build-heading">
        {/* The divider does the separating on desktop; the heading does it on mobile. */}
        <div className="space-y-3 border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div>
            <h2 id="build-heading" className="font-display text-lg font-semibold tracking-tight">
              Build your album
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Three ways to turn {ready > 0 ? `your ${ready} ` : ''}
              {ready === 1 ? 'photograph' : 'photographs'} into a finished book. You can change
              everything afterwards.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <MethodCard
              Icon={Dices}
              title="Auto Create Album"
              badge="Fastest"
              primary
              desc={
                autoTarget
                  ? `We arrange your photos into the “${autoTarget.name}” layout automatically.`
                  : 'We arrange your photos into a full album automatically.'
              }
              meta={
                autoTarget
                  ? [
                      { k: 'Layout', v: autoTarget.name },
                      { k: 'Holds', v: `${autoTarget.slotCount}` },
                      { k: 'Ready photos', v: `${ready}` },
                    ]
                  : [{ k: 'Ready photos', v: `${ready}` }]
              }
              note={
                processing > 0
                  ? `${processing} still processing — those stay in your tray to place yourself.`
                  : null
              }
              cta="Auto Create"
              onClick={onAutoCreate}
              disabled={busy}
            />

            <MethodCard
              Icon={LayoutTemplate}
              title="Choose Layouts"
              desc="Browse designed album layouts and pick the style you like."
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

            <MethodCard
              Icon={Sparkles}
              title="Design Album Yourself"
              desc="Open a blank album and place every photograph exactly where you want it."
              meta={[]}
              note={null}
              cta="Open builder"
              onClick={onDesignMyself}
              disabled={busy}
            />
          </div>

          {error && (
            <p role="alert" className="pt-1 text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * One build option. Compact enough for a rail, with a single clear action; the primary
 * one is the only card that carries the accent, so the hierarchy survives being stacked.
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
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-all duration-200 ease-glide ${
        disabled ? 'opacity-60' : 'hover:shadow-md'
      } ${primary ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/10' : 'bg-card'}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary/[0.07] text-primary ring-1 ring-primary/15">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">{title}</h3>
          {badge && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-primary/80">{badge}</span>
          )}
        </div>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>

      {meta.length > 0 && (
        <dl className="mt-3 space-y-1 border-t pt-2.5">
          {meta.map((m) => (
            <div key={m.k} className="flex items-center justify-between gap-2 text-[12px]">
              <dt className="text-muted-foreground">{m.k}</dt>
              <dd className="truncate font-medium tabular-nums text-foreground">{m.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}

      <Button
        onClick={onClick}
        disabled={disabled}
        variant={primary ? 'default' : 'outline'}
        className={`mt-3.5 w-full ${primary ? LUX_PRIMARY : ''}`}
      >
        <Icon /> {cta}
      </Button>
    </div>
  );
}
