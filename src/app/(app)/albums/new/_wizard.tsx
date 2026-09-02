'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
import { saveLayout, applyBlueprintToAlbum } from '@/lib/actions/builder';
import { photoCap } from '@/lib/builder/model';
import { autoLayout, type TemplateChoice } from '@/lib/builder/auto-layout';
import { applyBlueprint, type Blueprint } from '@/lib/builder/blueprint';
import type { CoverConfig } from '@/lib/builder/cover';
import { blueprintsForPageCount, selectAutoBlueprint } from '@/lib/builder/blueprint-select';
import { pendingPlacementsFor, resolveLayoutForSave } from '@/lib/builder/persist-layout';
import { usePendingPlacements } from '@/lib/builder/pending-placements';
import { isTempPhotoId } from '@/lib/uploads';
import { usePhotoPipeline } from '../[id]/build/_use-photo-pipeline';
import { layoutInputs } from '../[id]/build/_use-optimistic-layout';
import type { Photo } from '@/lib/builder/photo';
import type { ProductOption } from '@/lib/products/catalog';
import BlueprintPicker from './_blueprint-picker';
import SelectedDesign from './_selected-design';
import StepDetails from './_step-details';
import StepBuild from './_step-build';

/**
 * ALBUM CREATION — a TWO-step flow.
 *
 *   1 · Album Details   product · page count · destination · dates · words
 *   2 · Upload & Build  photos, and the three ways to turn them into a book
 *
 * It used to be four (Format → Begin → Memories → Create). That split was never a
 * property of the domain: Format and Begin cannot be submitted separately (the create
 * payload needs the product and page count together), and Memories and Create are
 * one moment — photos arrive, the album gets built.
 *
 * ONBOARDING COLLECTS TRIP INFORMATION ONLY. It asks for no cover, no price and — since
 * Phase 5 — no name. Every new album receives the admin's DEFAULT cover template (0052) and
 * a title DERIVED server-side from the trip details, both resolved in `createAlbumDraft`; the
 * cover catalog, custom design, template switching and the title itself all live in the
 * builder, where the customer actually has the album in front of them. Pricing belongs to
 * checkout, which is untouched.
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
  /** The design's own front cover (Phase 0) — how a blueprint is presented to a customer. */
  cover: CoverConfig | null;
  thumbUrl: string | null;
  /** The geometry itself — Auto Create applies it client-side (Phase 4). */
  blueprint: Blueprint;
};

export default function CreateWizard({
  albumProducts,
  templates = [],
  blueprints = [],
  stickerUrls = {},
  initialBlueprintId = null,
  designUnavailable = false,
}: {
  albumProducts: ProductOption[];
  /** Active layout presets — feed the deterministic auto-layout fallback. */
  templates?: TemplateChoice[];
  /** Active whole-album blueprints (0043) — the auto-select / choose-layout strategies. */
  blueprints?: WizardBlueprint[];
  /** Cover stickers for the blueprint picker, resolved by id server-side (Phase 0). */
  stickerUrls?: Record<string, string>;
  /**
   * THE DESIGN THE CUSTOMER ARRIVED WITH (Phase 2) — already resolved against the active catalog
   * by the page. An id and nothing more: every property of the design is read out of
   * `blueprints`, and the server re-resolves the id again on both write paths.
   */
  initialBlueprintId?: string | null;
  /** A design WAS requested but no longer resolves — said plainly rather than silently dropped. */
  designUnavailable?: boolean;
}) {
  const router = useRouter();
  /** Carries Auto Create's unresolved placements across the hand-off to the builder. */
  const pendingPlacements = usePendingPlacements();
  const [step, setStep] = useState(STEP_DETAILS);

  // ── Step 1 · Album Details ────────────────────────────────────────────────
  /*
   * THE TRIP STORY — destination, travel dates, a few words.
   *
   * These no longer have a UI: step 1 was reduced to the two decisions that are FIXED at
   * creation (the book and its page count), and the story fields moved out of the
   * album-creation screen entirely.
   *
   * The VALUES are kept, and every consumer below is untouched: `createAlbumDraft` still
   * receives `destination`, `travelDates` and `description`, so the server contract and its
   * derived-title fallback chain are unchanged; `composePeriod` and the inverted-date rule
   * still run; and the builder-entry veil still reads `destination`. They are plain constants
   * rather than state because nothing on this screen can change them any more — a `useState`
   * whose setter is never called is just a dead setter.
   *
   * To bring the fields back, restore the four `useState` pairs and pass them (plus their
   * setters and `dateError`) to `StepDetails` again — nothing downstream needs to change.
   */
  const destination: string = '';
  const fromDate: string = '';
  const toDate: string = '';
  const description: string = '';
  /*
   * ── THE CHOSEN DESIGN (Phase 2) ────────────────────────────────────────────
   *
   * `initialBlueprintId` was resolved server-side against the active catalog, so this lookup is
   * over rows the page already loaded — the URL contributed an id and nothing else.
   *
   * A design DECIDES THE PAGE COUNT, because a blueprint's layout is built for a book of an exact
   * length. So arriving with one preselects both the page count and a product that offers it,
   * turning step 1 from a blank configurator into a confirmation of what the customer already
   * chose on the public site.
   */
  const arrivedWith = initialBlueprintId ? blueprints.find((b) => b.id === initialBlueprintId) ?? null : null;

  const [albumProductId, setAlbumProductId] = useState(() => {
    const preferred = albumProducts.find((p) => p.isDefault) ?? albumProducts[0] ?? null;
    if (!arrivedWith) return preferred?.id ?? '';
    // Keep the default book when it can be made at the design's length; otherwise the first that can.
    if (preferred?.pageCounts.includes(arrivedWith.pageCount)) return preferred.id;
    return albumProducts.find((p) => p.pageCounts.includes(arrivedWith.pageCount))?.id ?? preferred?.id ?? '';
  });
  const [pageCount, setPageCount] = useState<number | null>(() =>
    arrivedWith && albumProducts.some((p) => p.pageCounts.includes(arrivedWith.pageCount))
      ? arrivedWith.pageCount
      : null,
  );

  /**
   * The design is held as an ID and everything about it is DERIVED, never mirrored into state —
   * so it cannot go stale when the customer changes the book beneath it.
   *
   * A design applies to a book of ITS length only. If the page count moves away from it, the
   * design is not silently discarded (which would look exactly like losing it across the login
   * that just happened) and not silently applied to the wrong length either: it is held aside
   * with one press back to the length it needs.
   */
  const [dismissedDesignId, setDismissedDesignId] = useState<string | null>(null);
  const chosenDesign = arrivedWith && arrivedWith.id !== dismissedDesignId ? arrivedWith : null;
  const designMismatch = chosenDesign !== null && pageCount !== null && chosenDesign.pageCount !== pageCount;
  /** The design that will actually be applied — null while it is on hold. */
  const selectedDesign = chosenDesign && !designMismatch ? chosenDesign : null;

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
  /** Synchronous double-submit guard — see `createAndContinue`. */
  const creatingRef = useRef(false);
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

  /**
   * PHOTOS AUTO CREATE CAN ACTUALLY PLACE (Phase 4).
   *
   * Auto Create used to wait for `status === 'ready'` — i.e. for the WORKER to finish — even
   * though the layout engine never needed anything the worker produces. All it reads is a photo's
   * shape, and the browser measures that the moment the file is picked. Waiting meant a customer
   * who had just dropped 40 photos was told to come back later.
   *
   * `layoutInputs` is the existing authority on "does this photo have a reliable shape?" — the
   * same projection the builder's Build-it-for-me uses. It prefers the worker's dimensions when
   * they exist, accepts browser-measured ones when they don't, and skips anything it cannot
   * establish confidently (HEIC, which no browser decodes, and failed uploads, which never get
   * measured). Reusing it is what keeps one definition of "usable" across both surfaces.
   */
  const usable = useMemo(() => layoutInputs(photos), [photos]);

  /**
   * Temp → real id resolution for the Auto Create save, derived from the upload manager's own
   * task table (Phase 3). A task records the real `photoId` the instant confirm returns, so this
   * is the authoritative mapping — not a second remapping system, and not a copy of the builder's
   * `idMap` ref, which belongs to a surface the wizard does not have.
   */
  const autoCreateIdResolver = useMemo(
    () => ({
      resolve: (id: string) => uploads.taskByTempPhotoId.get(id)?.photoId ?? id,
      isUnresolvedTemp: (id: string) => isTempPhotoId(id),
    }),
    [uploads.taskByTempPhotoId],
  );

  // ── Validation (step 1) ───────────────────────────────────────────────────
  // Every rule the server will apply, applied here first, so Continue is never a
  // guess. `missing` drives the footer hint — a disabled button that says why.
  const dateError = !!fromDate && !!toDate && fromDate > toDate;
  const travelPeriod = composePeriod(fromDate, toDate);

  // THE BOOK IS THE ONLY REQUIREMENT (Phase 5). Product and page count decide what is being made
  // and cannot be changed later, so they still gate Continue. Everything else on this step is
  // optional trip detail — including the name, which the customer is no longer asked for at all:
  // the server derives it, and the cover editor owns it from then on. The date rule stays because
  // an inverted range is a genuine mistake worth catching before it is stored.
  const missing = !albumProductId
    ? 'Choose an album to continue'
    : !pageCount
      ? 'Choose a page count to continue'
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
    /*
     * ONE ALBUM PER PRESS. `creating` disables the button, but a state flag is applied on the
     * NEXT render — a double click, a held Enter key or a retried tap can fire this handler twice
     * before that happens, and the result is two albums for one customer. The ref is written
     * synchronously, so the second call returns before it can reach the server. It is released
     * only on FAILURE; on success `albumId` above becomes the guard. (Same reasoning as the
     * `payInFlight` ref on checkout.)
     */
    if (creatingRef.current) return;
    creatingRef.current = true;

    setCreating(true);
    setError(null);
    // No cover ids are sent: onboarding no longer asks. The server applies the admin's
    // DEFAULT cover template (0052) — or leaves the cover blank when none is set — and the
    // customer changes it freely in the builder. Same call, same lifecycle, same timing.
    // No title is sent: since Phase 5 the server derives `albums.title` from these trip details
    // (destination → travel dates → "Untitled Album"), and the customer edits it in the builder.
    const res = await createAlbumDraft({
      albumProductId,
      pageCount: pageCount ?? undefined,
      /*
       * THE DESIGN, AS AN ID (Phase 2). This is the EXISTING Phase 0 creation path — the server
       * re-resolves the id through the active catalog and snapshots `blueprint.cover` onto the
       * album, exactly as it does for any other caller. No cover, no geometry and no metadata is
       * sent from the browser; omitting it (no design chosen, or one on hold) reproduces the
       * previous behaviour byte for byte, including the default-design fallback.
       */
      blueprintId: selectedDesign?.id,
      destination,
      travelDates: travelPeriod,
      description,
    });
    setCreating(false);

    if (!res.ok) {
      creatingRef.current = false; // released: no album exists, the customer may retry
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

  /**
   * CATALOG ORDER is preserved here on purpose: the deterministic tie-break resolves to the first
   * closest-capacity match, so selection must run over the order the catalog returned.
   */
  const selectableBlueprints = useMemo(
    () => (pageCount ? blueprintsForPageCount(blueprints, pageCount) : []),
    [blueprints, pageCount],
  );

  /** The same list, re-sorted for the picker. Display only — never used for selection. */
  const matchingBlueprints = useMemo(
    () =>
      [...selectableBlueprints].sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          Number(b.featured) - Number(a.featured) ||
          Number(b.popular) - Number(a.popular),
      ),
    [selectableBlueprints],
  );

  /**
   * The blueprint Auto Create WILL use. This is no longer a mirror of the server's choice — it is
   * the SAME function the server action calls (`selectAutoBlueprint`), so the preview shown in the
   * confirm dialog and the layout actually produced cannot disagree.
   */
  const autoTarget: WizardBlueprint | null = selectAutoBlueprint(selectableBlueprints, usable.length);

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
   * Auto Create entry — two gates, in order. Both now count USABLE photos (a reliable shape)
   * rather than worker-ready ones; everything else about them is unchanged.
   *
   *  1. HARD: zero usable photos. With nothing placeable, Auto Create would produce an album of
   *     empty frames and drop the customer into the builder wondering what happened. We stop
   *     before any navigation and before any layout is written, and say why.
   *  2. SOFT: fewer usable photos than the layout holds — the existing confirm, which offers
   *     "add more" or "continue anyway".
   */
  const runAutoCreate = () => {
    if (!albumId || !pageCount) return;
    if (usable.length === 0) {
      setAutoBlocked(true);
      return;
    }
    if (autoTarget && usable.length < autoTarget.slotCount) {
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
      /**
       * BOTH paths now run IN THE BROWSER, over `usable` — which is what lets a photo that is
       * still uploading be placed under its optimistic id. The engines are the existing pure
       * ones, called with exactly the arguments the previous code used; only the photo set and
       * the location of the call changed.
       *
       * The blueprint path used to be the server action, whose `readyPhotoIds()` query is the
       * very dependency Phase 4 removes. That action is untouched and still serves Choose Layout.
       */
      const chosen = selectAutoBlueprint(selectableBlueprints, usable.length);
      const ids = usable.map((p) => p.id);
      const blocks = chosen
        ? applyBlueprint(chosen.blueprint, ids)
        : autoLayout(usable, pageCount, 0, templates);

      /**
       * Optimistic ids cannot be persisted — `saveLayout` validates every referenced photo
       * against the album and would reject the WHOLE payload. The shared boundary resolves the
       * ones that have confirmed since the layout was built and strips the rest, keeping their
       * containers. The photos are not lost: they stay placed in the builder under their temp
       * ids, and the builder's next save persists them once they land.
       */
      const { blocks: payload, stripped } = resolveLayoutForSave(blocks, autoCreateIdResolver);

      /**
       * Remember where the stripped photos were meant to go, BEFORE navigating away takes this
       * component's state with it. The builder replays each one as its upload confirms, so the
       * arrangement the customer just saw is the arrangement they end up with — without anyone
       * re-running Auto Create over a photo set that has since changed.
       *
       * Written unconditionally (even when empty) so a second Auto Create run supersedes the
       * first rather than leaving stale coordinates behind.
       */
      pendingPlacements.set(albumId, pendingPlacementsFor(blocks, payload, autoCreateIdResolver));

      const res = await saveLayout({
        albumId,
        blocks: payload.map((b) => ({
          template: b.template,
          photoIds: b.photoIds.filter(Boolean),
          caption: b.caption,
          overlays: b.overlays,
          // Blueprints carry decorative elements; the auto-layout fallback simply has none.
          texts: b.texts,
          qrs: b.qrs,
          stickers: b.stickers,
          background: b.background,
        })),
      });
      ok = res.ok;
      if (!res.ok) errMsg = res.error;
      // `stripped` is intentionally not surfaced here: the customer is about to land in the
      // builder, where those photos are still placed and the existing save message already
      // explains the held-back placements at the moment it matters.
      void stripped;
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
          {/*
            Step 1 collects ONLY the two decisions that are fixed at creation. The trip-story
            fields it used to render live on below this call site — the state, the date rule,
            `composePeriod` and the create payload are all unchanged — they simply have no UI
            on this screen any more.
          */}
          {/*
            THE CHOSEN DESIGN, visible on BOTH steps. A customer who has just been through a
            login (or a signup and a verification email) needs to see that their choice came with
            them — an identical-looking blank wizard is indistinguishable from having lost it.
          */}
          <SelectedDesign
            design={chosenDesign}
            stickerUrls={stickerUrls}
            mismatchPageCount={designMismatch ? pageCount : null}
            onRestorePageCount={() => {
              if (!chosenDesign) return;
              // Move the product too when the current book cannot be made at that length.
              const current = albumProducts.find((p) => p.id === albumProductId);
              if (!current?.pageCounts.includes(chosenDesign.pageCount)) {
                const fit = albumProducts.find((p) => p.pageCounts.includes(chosenDesign.pageCount));
                if (fit) setAlbumProductId(fit.id);
              }
              setPageCount(chosenDesign.pageCount);
            }}
            onClear={() => setDismissedDesignId(chosenDesign?.id ?? null)}
          />

          {/*
            A DESIGN THAT NO LONGER EXISTS. It was active when the customer chose it and is not
            now — deactivated, archived, or simply an id that never resolved. Creation continues
            unaffected; saying nothing would be the only wrong answer.
          */}
          {designUnavailable && !chosenDesign && (
            <p
              role="status"
              className="animate-rise mb-6 rounded-2xl border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground"
            >
              That design isn’t available any more. You can start your album here and pick another
              layout in a moment — everything else works exactly the same.
            </p>
          )}

          {step === STEP_DETAILS && (
            <StepDetails
              albumProducts={albumProducts}
              albumProductId={albumProductId}
              pageCount={pageCount}
              /* The gate and the action stay here; the step only renders the button. */
              canContinue={canContinue}
              creating={creating}
              onContinue={createAndContinue}
              onSelectProduct={selectProduct}
              onSelectPageCount={setPageCount}
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
              selectedDesign={selectedDesign}
              onAutoCreate={runAutoCreate}
              onChooseLayouts={() => setBpPickerOpen(true)}
              onDesignMyself={launchBuilder}
              /*
                The chosen design is applied through `runApplyBlueprint` — the SAME call the
                layout picker makes, which is the same `applyBlueprintToAlbum` server action that
                re-resolves the id against the active catalog. There is no second apply path.
                Auto-place is used only when there is something to place.
              */
              onUseDesign={() => selectedDesign && runApplyBlueprint(selectedDesign.id, ready.length > 0)}
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
      {/*
        Step 1's Continue moved INTO the content, centred under the choices that enable it (see
        `StepDetails`). What is left here is the status line it always carried — "Choose a page
        count to continue" — which is still the one place the reason for a disabled button is
        stated. Centred now that it is the only thing in the bar.
      */}
      {step === STEP_DETAILS && (
        <footer className="sticky bottom-0 z-20 flex h-[52px] items-center justify-center gap-4 border-t bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
          <p className="min-w-0 truncate text-[13px] text-muted-foreground">
            {missing ?? 'Everything looks good.'}
          </p>
        </footer>
      )}

      {/* Layout browser */}
      {bpPickerOpen && (
        <BlueprintPicker
          blueprints={matchingBlueprints}
          uploaded={ready.length}
          busy={bpBusy}
          stickerUrls={stickerUrls}
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
              {photos.length === 0 ? 'Upload some photos first' : 'These photos need a moment'}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {photos.length === 0
                ? 'Auto Create arranges your photographs into the album, so it needs at least one to work with.'
                : // Auto Create no longer waits for the worker — it needs a photo's SHAPE, which the
                  // browser measures on selection. So the only photos it cannot place are ones whose
                  // shape it could not read: formats the browser can't open (HEIC) and uploads that
                  // failed. Saying "still processing" here would now be wrong.
                  'Auto Create arranges photographs by their shape, and it couldn’t read one for any of these — HEIC files need processing first, and failed uploads can’t be used. Try again shortly, or design the album yourself.'}
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
              {autoConfirm.slotCount} photos and {usable.length} of yours {usable.length === 1 ? 'is' : 'are'} ready to
              place — uploading ones included. You can add more, or continue now — the extra frames stay empty for you
              to fill later.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                { k: 'Capacity', v: autoConfirm.slotCount },
                { k: 'Placing', v: usable.length },
                { k: 'Empty frames', v: Math.max(0, autoConfirm.slotCount - usable.length) },
                { k: 'Unused', v: Math.max(0, usable.length - autoConfirm.slotCount) },
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
          {/*
            The veil used to print the name the customer had just typed. There is no client-side
            title any more, and inventing one here would be a second, disagreeing source of truth
            — the album's real name is derived server-side. It shows the DESTINATION instead when
            there is one: it is the customer's own word for this trip, it is the same thing the
            server leads with, and when there isn't one the line falls back to the house phrase.
            Purely a transition flourish; it makes no claim about what the album is called.
          */}
          <h2 className="animate-rise mt-6 max-w-[18ch] font-display text-[clamp(2.5rem,7vw,4rem)] font-normal leading-tight text-primary-foreground">
            {destination.trim() || 'Your story'}
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
