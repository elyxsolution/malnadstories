'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ImageIcon, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import WizardProgress from '@/components/wizard-progress';
import { wizardStepIndex } from '@/lib/wizard/steps';
import { createAlbumDraft } from '@/lib/actions/albums';
import { saveLayout, applyBlueprintToAlbum, autoSelectAndApplyBlueprint } from '@/lib/actions/builder';
import { photoCap } from '@/lib/builder/model';
import { autoLayout, serializeBlocks, type EnginePhoto, type TemplateChoice } from '@/lib/builder/auto-layout';
import { usePhotoPipeline } from '../[id]/build/_use-photo-pipeline';
import type { Photo } from '@/lib/builder/photo';
import type { ProductOption } from '@/lib/products/catalog';
import BlueprintPicker from './_blueprint-picker';
import StepDetails from './_step-details';
import StepBuild from './_step-build';

/**
 * ALBUM CREATION — a TWO-step flow.
 *
 *   1 · Album Details   product · page count · title · destination · dates · words
 *   2 · Upload & Build  photos, and the three ways to turn them into a book
 *
 * It used to be four (Format → Begin → Memories → Create). That split was never a
 * property of the domain: Format and Begin cannot be submitted separately (the create
 * payload requires product, page count AND title together), and Memories and Create are
 * one moment — photos arrive, the album gets built.
 *
 * ONBOARDING COLLECTS ALBUM INFORMATION ONLY. It no longer asks for a cover and no longer
 * shows a price. Every new album receives the admin's DEFAULT cover template (0052),
 * resolved server-side; the full cover catalog, custom design and template switching all
 * remain in the builder, where the customer actually has the album in front of them.
 * Pricing belongs to checkout, which is untouched.
 *
 * THE BACKEND LIFECYCLE IS UNCHANGED. The album is still created at exactly one point,
 * by exactly one call: `createAlbumDraft`, on leaving step 1. Uploads still go
 * presign → R2 → confirm → poll through the shared pipeline. The three build methods
 * still call the same three server actions with the same arguments. Nothing about the
 * worker, the queue, R2, the album model or the builder moved.
 *
 * `WIZARD_STEPS` (src/lib/wizard/steps.ts) is the only place a step is declared. This
 * file holds no step labels, no step count, and no bare step indices.
 */

const STEP_DETAILS = wizardStepIndex('details');
const STEP_BUILD = wizardStepIndex('build');

/** Matches CreateAlbumSchema's `title` bound, so the client can no longer disagree with it. */
const TITLE_MAX = 100;

/** Staged copy for Auto Create's loading screen. */
const AUTO_STAGES = [
  'Finding suitable layouts…',
  'Comparing photo capacity…',
  'Selecting the best layout…',
  'Placing your photos…',
  'Preparing your album…',
  'Opening the builder…',
] as const;

/** Stable empty seed — a new album starts with no photos. */
const EMPTY_PHOTOS: Photo[] = [];

// ── Album period ────────────────────────────────────────────────────────────
// Native date inputs give YYYY-MM-DD. We compose one human-readable string into the
// EXISTING albums.travel_dates text column (no schema change). Backward-compatible:
// old free-text values still display.
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function composePeriod(from: string, to: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  return formatDate(from || to) || '';
}

export type WizardBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isDefault: boolean;
  isNew: boolean;
  breakdown: { label: string; count: number }[];
  thumbUrl: string | null;
};

export default function CreateWizard({
  albumProducts,
  templates = [],
  blueprints = [],
}: {
  albumProducts: ProductOption[];
  /** Active layout presets — feed the deterministic auto-layout fallback. */
  templates?: TemplateChoice[];
  /** Active whole-album blueprints (0043) — the auto-select / choose-layout strategies. */
  blueprints?: WizardBlueprint[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(STEP_DETAILS);

  // ── Step 1 · Album Details ────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [description, setDescription] = useState('');
  const [albumProductId, setAlbumProductId] = useState(
    albumProducts.find((p) => p.isDefault)?.id ?? albumProducts[0]?.id ?? '',
  );
  const [pageCount, setPageCount] = useState<number | null>(null);

  /**
   * Destination is now its OWN field. The title keeps its location autocomplete because it
   * is a genuinely nice way to name a trip, but selecting a location there only FILLS an
   * empty destination — it never overwrites what the customer typed, and (unlike before)
   * editing the title never silently erases the destination.
   */
  const applyTitleLocation = useCallback((loc: string) => {
    setDestination((d) => (d.trim() ? d : loc));
  }, []);

  const selectProduct = useCallback(
    (id: string) => {
      setAlbumProductId(id);
      const next = albumProducts.find((p) => p.id === id);
      // Keep the page count only if the newly-chosen product still offers it.
      setPageCount((pc) => (next && pc != null && !next.pageCounts.includes(pc) ? null : pc));
    },
    [albumProducts],
  );

  // ── Created album ─────────────────────────────────────────────────────────
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false); // cinematic builder-entry veil

  /**
   * THE SAME photo pipeline the builder uses — bounded upload queue, optimistic photos, the
   * progressive poll, URL refresh and blob cleanup, in one shared hook. The wizard passes
   * neither `onRemapId` nor `onPhotoDropped`: it has no layout, so there are no block
   * references to remap or strip.
   */
  const pipeline = usePhotoPipeline({
    albumId,
    initialPhotos: EMPTY_PHOTOS,
    pollImmediately: true,
    pollWhen: true,
  });
  const { photos, uploads } = pipeline;

  // ── Step 2 · build strategies ─────────────────────────────────────────────
  const [bpBusy, setBpBusy] = useState(false);
  const [bpError, setBpError] = useState<string | null>(null);
  const [bpPickerOpen, setBpPickerOpen] = useState(false);
  const [bpResult, setBpResult] = useState<{ name: string; capacity: number; placed: number; unused: number } | null>(
    null,
  );
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoStage, setAutoStage] = useState(0);
  const [autoConfirm, setAutoConfirm] = useState<WizardBlueprint | null>(null);
  /** Auto Create pressed with no usable photos — hard-blocked, warning shown. */
  const [autoBlocked, setAutoBlocked] = useState(false);
  /** Scroll target so the warning's "Upload photos" lands on the dropzone. */
  const uploadAnchorRef = useRef<HTMLDivElement>(null);

  const cap = pageCount ? photoCap(pageCount) : 100;
  const ready = photos.filter((p) => p.status === 'ready');

  // ── Validation (step 1) ───────────────────────────────────────────────────
  // Every rule the server will apply, applied here first, so Continue is never a
  // guess. `missing` drives the footer hint — a disabled button that says why.
  const trimmedTitle = title.trim();
  const dateError = !!fromDate && !!toDate && fromDate > toDate;
  const titleTooLong = trimmedTitle.length > TITLE_MAX;
  const travelPeriod = composePeriod(fromDate, toDate);

  const missing = !albumProductId
    ? 'Choose an album to continue'
    : !pageCount
      ? 'Choose a page count to continue'
      : !trimmedTitle
        ? 'Name your album to continue'
        : titleTooLong
          ? `Titles are limited to ${TITLE_MAX} characters`
          : dateError
            ? 'Check your travel dates'
            : null;
  const canContinue = missing === null;

  /**
   * ALBUM CREATION — the single point, unchanged. Called once, on leaving step 1, with
   * exactly the payload the four-step wizard sent.
   */
  const createAndContinue = async () => {
    if (albumId) return setStep(STEP_BUILD); // already created (defensive; the button is hidden)
    if (!canContinue) return;

    setCreating(true);
    setError(null);
    // No cover ids are sent: onboarding no longer asks. The server applies the admin's
    // DEFAULT cover template (0052) — or leaves the cover blank when none is set — and the
    // customer changes it freely in the builder. Same call, same lifecycle, same timing.
    const res = await createAlbumDraft({
      title: trimmedTitle,
      albumProductId,
      pageCount: pageCount ?? undefined,
      destination,
      travelDates: travelPeriod,
      description,
    });
    setCreating(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAlbumId(res.id);
    setStep(STEP_BUILD);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  // ── Builder handoff ───────────────────────────────────────────────────────
  const launchBuilder = useCallback(() => {
    if (!albumId) return;
    setEntering(true);
    setTimeout(() => router.push(`/albums/${albumId}/build`), 700);
  }, [albumId, router]);

  const matchingBlueprints = blueprints
    .filter((b) => !!pageCount && b.pageCount === pageCount)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        Number(b.featured) - Number(a.featured) ||
        Number(b.popular) - Number(a.popular),
    );

  /** The blueprint Auto Create WILL use — mirrors the server's deterministic choice. */
  const autoTarget: WizardBlueprint | null = matchingBlueprints.length
    ? (matchingBlueprints.find((b) => b.isDefault) ??
      matchingBlueprints.reduce(
        (best, b) => (Math.abs(b.slotCount - ready.length) < Math.abs(best.slotCount - ready.length) ? b : best),
        matchingBlueprints[0],
      ))
    : null;

  /** Option 2 — apply a chosen blueprint (optionally auto-placing photos). */
  const runApplyBlueprint = async (bpId: string, autoPlace: boolean) => {
    if (!albumId) return;
    setBpBusy(true);
    setBpError(null);
    const res = await applyBlueprintToAlbum({ albumId, blueprintId: bpId, autoPlace });
    setBpBusy(false);
    if (!res.ok) return setBpError(res.error);
    if (autoPlace) {
      const name = matchingBlueprints.find((b) => b.id === bpId)?.name ?? 'Layout';
      setBpPickerOpen(false);
      setBpResult({ name, capacity: res.capacity, placed: res.placed, unused: res.unused });
    } else {
      setBpPickerOpen(false);
      launchBuilder();
    }
  };

  /**
   * Auto Create entry — two gates, in order:
   *
   *  1. HARD: zero usable photos. Auto Create places only photos the worker has finished
   *     (`readyPhotoIds` server-side), so with none ready it would produce an album of empty
   *     frames and drop the customer into the builder wondering what happened. We stop before
   *     any navigation and before any layout is written, and say why.
   *  2. SOFT: fewer ready photos than the layout holds — the existing confirm, which offers
   *     "add more" or "continue anyway". Unchanged.
   */
  const runAutoCreate = () => {
    if (!albumId || !pageCount) return;
    if (ready.length === 0) {
      setAutoBlocked(true);
      return;
    }
    if (autoTarget && ready.length < autoTarget.slotCount) {
      setAutoConfirm(autoTarget);
      return;
    }
    void proceedAutoCreate();
  };

  /** Dismiss the warning and take the customer to the dropzone. */
  const goToUploader = () => {
    setAutoBlocked(false);
    uploadAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Auto Create — staged loading, then blueprint auto-select (or, if no matching blueprints
   * exist for this size, the deterministic auto-layout). Always ends in the builder.
   */
  const proceedAutoCreate = async () => {
    if (!albumId || !pageCount) return;
    setBpError(null);
    setAutoConfirm(null);
    setAutoStage(0);
    setAutoCreating(true);

    const timer = setInterval(
      () => setAutoStage((s) => Math.min(s + 1, AUTO_STAGES.length - 2)),
      700,
    );
    const startedAt = Date.now();

    let ok = false;
    let errMsg: string | null = null;
    try {
      if (matchingBlueprints.length > 0) {
        const res = await autoSelectAndApplyBlueprint({ albumId });
        ok = res.ok;
        if (!res.ok) errMsg = res.error;
      } else {
        const enginePhotos: EnginePhoto[] = ready.map((p) => ({
          id: p.id,
          width: p.width ?? null,
          height: p.height ?? null,
          takenAt: p.takenAt,
        }));
        const blocks = autoLayout(enginePhotos, pageCount, 0, templates);
        const res = await saveLayout({ albumId, blocks: serializeBlocks(blocks) });
        ok = res.ok;
        if (!res.ok) errMsg = res.error;
      }
    } catch {
      errMsg = 'Something went wrong. Please try again.';
    }
    clearInterval(timer);

    // Keep the loader on-screen long enough that it never flashes.
    await new Promise((r) => setTimeout(r, Math.max(0, 2600 - (Date.now() - startedAt))));
    if (!ok) {
      setAutoCreating(false);
      setBpError(errMsg ?? 'Could not auto-create your album.');
      return;
    }
    setAutoStage(AUTO_STAGES.length - 1);
    setTimeout(() => router.push(`/albums/${albumId}/build`), 500);
  };

  const featuredCount = matchingBlueprints.filter((b) => b.featured || b.pinned).length;
  const categoryCount = new Set(matchingBlueprints.map((b) => b.category)).size;

  return (
    <div className="brand-surface flex min-h-screen flex-col">
      {/* THE ONE WIZARD NAVBAR — the global app header is suppressed on this route
          (see app-header-gate), so this bar is the only chrome above the flow. */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
        <Link
          href="/dashboard"
          aria-label="Malnad Stories — back to dashboard"
          className="group inline-flex flex-none items-center gap-2 rounded-lg tracking-tight transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
        >
          <NextImage
            src="/logo.png"
            alt=""
            width={447}
            height={558}
            priority
            unoptimized
            className="h-7 w-auto transition-transform duration-200 group-hover:scale-105"
          />
          <span className="hidden font-display text-[15px] font-semibold sm:inline">Malnad Stories</span>
        </Link>

        <WizardProgress current={step} tone="brand" className="hidden md:flex" />

        <button
          type="button"
          onClick={() => router.push(albumId ? `/albums/${albumId}/build` : '/dashboard')}
          className="flex-none rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {albumId ? 'Save & exit' : 'Cancel'}
        </button>
      </header>

      {/* Compact progress for small screens, where the header bar has no room. */}
      <div className="border-b bg-background/60 px-5 py-2.5 md:hidden">
        <WizardProgress current={step} tone="brand" className="justify-center" />
      </div>

      <main className="flex-1 px-5 pb-16 sm:px-8">
        <div className="animate-rise mx-auto w-full max-w-6xl py-8 sm:py-10">
          {step === STEP_DETAILS && (
            <StepDetails
              albumProducts={albumProducts}
              albumProductId={albumProductId}
              pageCount={pageCount}
              title={title}
              destination={destination}
              fromDate={fromDate}
              toDate={toDate}
              description={description}
              dateError={dateError}
              titleTooLong={titleTooLong}
              titleMaxLength={TITLE_MAX}
              onSelectProduct={selectProduct}
              onSelectPageCount={setPageCount}
              onTitleChange={setTitle}
              onTitleLocation={applyTitleLocation}
              onDestinationChange={setDestination}
              onFromDateChange={setFromDate}
              onToDateChange={setToDate}
              onDescriptionChange={setDescription}
            />
          )}

          {step === STEP_BUILD && albumId && (
            <StepBuild
              albumId={albumId}
              cap={cap}
              photos={photos}
              uploads={uploads}
              blueprints={matchingBlueprints}
              autoTarget={autoTarget}
              categoryCount={categoryCount}
              featuredCount={featuredCount}
              busy={autoCreating || bpBusy}
              error={bpError}
              uploadAnchorRef={uploadAnchorRef}
              onAutoCreate={runAutoCreate}
              onChooseLayouts={() => setBpPickerOpen(true)}
              onDesignMyself={launchBuilder}
            />
          )}

          {error && (
            <p role="alert" className="mt-6 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </main>

      {/*
        FOOTER. Step 1 carries the single Continue. Step 2 deliberately has NO forward
        action — the three build cards are the exit, and a fourth "continue" next to them
        would be exactly the extra navigation step this flow exists to remove.
      */}
      {step === STEP_DETAILS && (
        <footer className="sticky bottom-0 z-20 flex h-[72px] items-center justify-between gap-4 border-t bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
          <p className="min-w-0 truncate text-[13px] text-muted-foreground">
            {missing ?? 'Everything looks good.'}
          </p>
          <Button onClick={createAndContinue} disabled={!canContinue || creating} className={`flex-none ${LUX_PRIMARY}`}>
            {creating ? <InlineLoader /> : null}
            {creating ? 'Creating…' : 'Continue'}
            {!creating && <ArrowRight />}
          </Button>
        </footer>
      )}

      {/* Layout browser */}
      {bpPickerOpen && (
        <BlueprintPicker
          blueprints={matchingBlueprints}
          uploaded={ready.length}
          busy={bpBusy}
          onApply={runApplyBlueprint}
          onClose={() => setBpPickerOpen(false)}
        />
      )}

      {/* Layout applied — summary + launch */}
      {bpResult && (
        <div className="animate-fade-in fixed inset-0 z-[115] flex items-center justify-center bg-black/60 p-4">
          <div className="animate-scale-in w-full max-w-sm rounded-2xl border bg-background p-6 text-center shadow-elevated">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/[0.08] text-primary ring-1 ring-primary/15">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">Your album is arranged</h2>
            <p className="mt-1 text-sm text-muted-foreground">{bpResult.name}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Capacity', value: bpResult.capacity },
                { label: 'Placed', value: bpResult.placed },
                { label: 'Unused', value: bpResult.unused },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-card px-1.5 py-2">
                  <div className="text-lg font-semibold tabular-nums text-foreground">{s.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <Button onClick={launchBuilder} className={`mt-5 w-full ${LUX_PRIMARY}`}>
              Open my album <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {/*
        Auto Create — HARD block: no usable photos. Same overlay language as every other
        dialog in this flow (backdrop click to dismiss, scale-in panel), not a browser alert.
        Nothing was navigated and no layout was written when this appears.
      */}
      {autoBlocked && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="auto-blocked-title"
          className="animate-fade-in fixed inset-0 z-[118] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAutoBlocked(false)}
        >
          <div
            className="animate-scale-in w-full max-w-sm rounded-2xl border bg-background p-6 text-center shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/[0.12] text-warning ring-1 ring-warning/25">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 id="auto-blocked-title" className="mt-3 font-display text-xl font-semibold tracking-tight">
              {photos.length === 0 ? 'Upload some photos first' : 'Your photos are still processing'}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {photos.length === 0
                ? 'Auto Create arranges your photographs into the album, so it needs at least one to work with.'
                : 'Auto Create can only place photographs that have finished processing. Give it a moment, or design the album yourself in the meantime.'}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button onClick={goToUploader} className={LUX_PRIMARY}>
                <ImageIcon /> Upload photos
              </Button>
              <Button variant="ghost" onClick={() => setAutoBlocked(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Create — "not enough photos" soft confirm (never fails) */}
      {autoConfirm && (
        <div
          className="animate-fade-in fixed inset-0 z-[118] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAutoConfirm(null)}
        >
          <div
            className="animate-scale-in w-full max-w-md rounded-2xl border bg-background p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-xl font-semibold tracking-tight">A few more photos will fill it out</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The <span className="font-medium text-foreground">{autoConfirm.name}</span> layout holds{' '}
              {autoConfirm.slotCount} photos and {ready.length} of yours {ready.length === 1 ? 'is' : 'are'} ready. You
              can add more, or continue now — the extra frames stay empty for you to fill later.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                { k: 'Capacity', v: autoConfirm.slotCount },
                { k: 'Ready', v: ready.length },
                { k: 'Empty frames', v: Math.max(0, autoConfirm.slotCount - ready.length) },
                { k: 'Unused', v: Math.max(0, ready.length - autoConfirm.slotCount) },
              ].map((s) => (
                <div key={s.k} className="rounded-lg border bg-card px-1.5 py-2">
                  <div className="text-base font-semibold tabular-nums">{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.k}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {/* Both options stay on this screen — uploading IS this screen now. */}
              <Button variant="outline" onClick={() => setAutoConfirm(null)}>
                <ImageIcon /> Add more photos
              </Button>
              <Button onClick={proceedAutoCreate} className={LUX_PRIMARY}>
                Continue anyway <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Create — staged loading */}
      {autoCreating && (
        <div className="animate-fade-in fixed inset-0 z-[125] flex flex-col items-center justify-center bg-[linear-gradient(180deg,hsl(156_36%_12%),hsl(156_36%_8%))] px-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-gold ring-1 ring-white/10">
            <Wand2 className="h-7 w-7 animate-pulse" />
          </span>
          <h2 className="mt-6 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-normal leading-tight text-primary-foreground">
            Creating your album
          </h2>
          <ol className="mt-7 space-y-2.5 text-left">
            {AUTO_STAGES.map((s, i) => (
              <li
                key={s}
                className={`flex items-center gap-3 text-[15px] transition-all duration-300 ${
                  i <= autoStage ? 'text-primary-foreground' : 'text-primary-foreground/30'
                }`}
              >
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-full transition-colors ${
                    i < autoStage ? 'bg-gold text-background' : i === autoStage ? 'bg-white/15 text-gold' : 'bg-white/5'
                  }`}
                >
                  {i < autoStage ? <Check className="h-3 w-3" /> : i === autoStage ? <InlineLoader /> : null}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Cinematic builder-entry veil */}
      {entering && (
        <div
          onClick={() => router.push(`/albums/${albumId}/build`)}
          className="animate-fade-in fixed inset-0 z-[120] flex cursor-pointer flex-col items-center justify-center bg-[linear-gradient(180deg,hsl(156_36%_12%),hsl(156_36%_8%))] text-center"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-gold/80">Opening your album</p>
          <h2 className="animate-rise mt-6 max-w-[18ch] font-display text-[clamp(2.5rem,7vw,4rem)] font-normal leading-tight text-primary-foreground">
            {trimmedTitle || 'Your story'}
          </h2>
          <span className="mt-7 h-px w-60 bg-[linear-gradient(90deg,transparent,hsl(var(--gold)/0.6),transparent)]" />
          <div className="mt-8 flex items-center gap-3 text-sm text-primary-foreground/70">
            <InlineLoader /> Preparing your spreads…
          </div>
          <p className="absolute bottom-6 text-[10px] uppercase tracking-widest text-primary-foreground/30">
            Click anywhere to skip
          </p>
        </div>
      )}
    </div>
  );
}
