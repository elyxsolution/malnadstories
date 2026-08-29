'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  Images,
  LayoutTemplate as LayoutTemplateIcon,
  Type as TypeIcon,
  Palette,
  QrCode,
  Sticker,
  Hand,
  Plus,
  Square,
  LayoutGrid,
  Rows3,
  Wand2,
  ChevronLeft,
  ChevronRight,
  BookImage,
  Eye,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import Uploader from './_uploader';
import type { Photo } from '@/lib/builder/photo';
import { isTempPhotoId } from '@/lib/uploads';
import Tray from './_tray';
import TrayToolbar from './_tray-toolbar';
import BlockCard, { PhotoPicker } from './_block';
import ContextBar from './_context-bar';
import { useAnchorRect, FULL_PAGE, type NormRect } from './_use-anchor-rect';
import { useCanvasCrop } from './_use-canvas-crop';
import SubmitValidationDialog from './_submit-validation-dialog';
import ConfirmSubmitDialog from './_confirm-submit-dialog';
import { evaluateAlbum, type AlbumValidationReport, type IssueAction } from '@/lib/albums/validation';
import { type RenderReadinessReport } from '@/lib/albums/render-readiness';
import { LoadingOverlay } from '@/components/loading';
import PairContent, { PrintGutter } from './_pair-frame';
import Navigator from './_navigator';
import BuilderHeader from './_header';
import CanvasToolbar from './_toolbar';
import AlbumSettings from './_album-settings';
import ReviewRevisionCard from './_review-revision';
import { BlueprintHeader, ExitBlueprintDialog, type BlueprintMeta } from './_blueprint-chrome';
import LayoutsPanel from './_panel-layouts';
import BackgroundsPanel from './_panel-backgrounds';
import QrPanel from './_panel-qr';
import TextPanel from './_panel-text';
import ShortcutsOverlay from './_shortcuts';
import BuildMethod, { type BuilderBlueprint } from './_build-method';
import BlueprintPicker from '../../new/_blueprint-picker';
import Proposal from './_proposal';
import CoverCanvas from './_cover-canvas';
import CoverContextBar from './_cover-bar';
import { useCover } from './_use-cover';
import { CoverSpread } from './_cover-render';
import CoverTemplatesPanel, { type BuilderCoverTemplate } from './_panel-cover-templates';
import StickersPanel from './_panel-stickers';
import { TextInspector, StickerInspector, QrInspector, PhotoAdjustInspector } from './_element-inspectors';
import PropertiesPanel from './_properties-panel';
// `_inspector` (the permanent right-hand panel) was retired in Pass 2 — its photo adjustments
// moved into `_element-inspectors` beside their siblings, and its page actions became the
// context bar's page toolbar. Nothing it did was dropped; everything it did moved.
import { useBlocks, NO_SELECTION, type Selection, type BaseSlot } from './_use-builder';
import { fitBlockWidth, useMeasuredBox } from './_use-fit-scale';
import { useEditHistory } from './_use-edit-history';
import { usePhotoEditHistory } from './_use-photo-edits';
import { useSelection } from './_use-selection';
import { findFrameHolding, selectedFrames, selectedPhotoIds, targetKey, type SelectionTarget } from './_selection-model';
import SelectionBar from './_selection-bar';
import { useCommands } from './_use-commands';
import { useShortcuts, type Shortcut } from './_use-shortcuts';
import ContextMenu, { useContextMenu } from './_context-menu';
import { useDragStore } from './_use-drag';
import { useMarquee, MarqueeBox } from './_use-marquee';
import { useTrayFilters, useFavourites } from './_tray-filters';
import { useLabels, PHOTO_LABELS, LABEL_META } from './_photo-labels';
import { useLayoutMemory } from './_layout-memory';
import { profileShapes, suggestLayouts } from './_layout-suggestions';
import {
  activeBaseSlots,
  albumStatistics,
  inspectAlbum,
  pairWidthInches,
  type QualityIssue,
} from './_quality-model';
import QualityPanel from './_panel-quality';
import {
  autoLayout,
  regenerate,
  fillEmptyFrames,
  summarizePlan,
  type EnginePhoto,
} from '@/lib/builder/auto-layout';
import {
  photoCap,
  pagesConsumed,
  canAdd,
  placedPhotoIds,
  isBlockComplete,
  trimBaseIds,
  PAGE_COST,
  type Block,
  type EditConfig,
  type LayoutTemplate,
  type TextVariant,
} from '@/lib/builder/model';
import { type LayoutPreset } from '@/lib/builder/elements';
import { layoutCycleSteps, nextCycleIndex, layoutByDensity, currentLayoutLabel } from '@/lib/builder/layout-cycle';
import { clampRect, EDIT_BOUNDS, PASTEBOARD_PCT } from '@/lib/builder/edit-bounds';
import { useBuilderDimensions } from './_dimensions';
import { autoAlignBlock, autoAlignCover } from '@/lib/builder/auto-align';
import { applyBlueprint } from '@/lib/builder/blueprint';
import { isCustomCover, type CoverConfig } from '@/lib/builder/cover';
import { freeTexts } from '@/lib/builder/model';
import { COVER_SIDE_LABEL, isPermanentRole, type CoverSide } from '@/lib/builder/cover-objects';
import { type StickerCategory } from '@/lib/stickers';
import { saveLayout, submitAlbum, saveCoverDesign, savePhotoEdit } from '@/lib/actions/builder';
import { Button } from '@/components/ui/button';
import { type CoverOption } from '@/lib/covers';
import { type ActiveTemplate } from '@/lib/templates/catalog';
import { resolvePhotoUrl, revokeLocalPreview } from '@/lib/builder/photo-url';
import { useIdMap } from './_use-id-map';
import { usePhotoPipeline } from './_use-photo-pipeline';
import { useBlueprintMode } from './_use-blueprint-mode';
import { PhotoModals, ResubmittedDialog, ExitGuardDialog } from './_builder-modals';
import { useSaveController } from './_use-save-controller';
import { usePhotoFor } from './_use-photo-for';
import { useIdlePreload } from './_use-idle-preload';
import { isPlaceable, photoUiState } from './_photo-state';
import { layoutInputs, useOptimisticLayout } from './_use-optimistic-layout';
import { usePendingPlacements } from '@/lib/builder/pending-placements';
import SessionStatus from './_session-status';
import { STUDIO_PRIMARY } from './_ui';

// The flipbook (react-pageflip) is a client-only modal — load it on demand and skip SSR so
// the library never touches `window` during render, and its bundle only ships when opened.
const Flipbook = dynamic(() => import('./_flipbook'), { ssr: false });

/**
 * Review mode is a full-screen surface most sessions never open, so it is code-split the same
 * way the flipbook is — the builder's initial bundle is unchanged by Phase 7.
 */
const ReviewMode = dynamic(() => import('./_review-mode'), { ssr: false });

/** Custom-mode auto-fill kinds (Fill Empty / Replace All / Randomize). Replaces the old AssistKind. */
type LayoutKind = 'build' | 'fill' | 'suggest';

type RailTab = 'images' | 'layouts' | 'templates' | 'text' | 'stickers' | 'backgrounds' | 'qr' | 'quality';
// 'layouts' is content-page only; 'templates' (cover designs) is cover-only. The rail is filtered
// per mode below so each shows only its relevant tools. 'quality' (Phase 7) is available in both,
// because a cover has quality problems too.
const RAIL: { key: RailTab; label: string; Icon: typeof Images }[] = [
  { key: 'images', label: 'Images', Icon: Images },
  { key: 'layouts', label: 'Layouts', Icon: LayoutTemplateIcon },
  { key: 'templates', label: 'Templates', Icon: BookImage },
  { key: 'text', label: 'Text', Icon: TypeIcon },
  { key: 'stickers', label: 'Stickers', Icon: Sticker },
  { key: 'backgrounds', label: 'Backdrop', Icon: Palette },
  { key: 'qr', label: 'QR', Icon: QrCode },
  { key: 'quality', label: 'Quality', Icon: ShieldCheck },
];

export default function Builder({
  albumId,
  title,
  size,
  email,
  productName = null,
  destination = null,
  travelDates = null,
  description = null,
  initialStatus,
  initialPhotos,
  initialBlocks,
  covers,
  initialCoverId,
  initialCoverConfig,
  initialReview,
  initialRenderReadiness = null,
  layoutTemplates = [],
  coverTemplates = [],
  blueprints = [],
  blueprintDraftOf = null,
  blueprintMeta = null,
  stickerCatalog = [],
  stickerUrls = {},
}: {
  albumId: string;
  title: string;
  size: number;
  email: string;
  /** Album metadata for the Album Settings hub (General + Format summary). */
  productName?: string | null;
  destination?: string | null;
  travelDates?: string | null;
  description?: string | null;
  initialStatus: string;
  initialPhotos: Photo[];
  initialBlocks: Block[];
  covers: CoverOption[];
  initialCoverId: string | null;
  initialCoverConfig: CoverConfig;
  initialReview: {
    status: string;
    requestedChanges: string | null;
    requestedAt?: string | null;
    revisionNumber?: number;
  } | null;
  /** Render-readiness snapshot (review mode) — consumed by the shared PrintDiagnostics, never recomputed. */
  initialRenderReadiness?: RenderReadinessReport | null;
  layoutTemplates?: ActiveTemplate[];
  /** Active cover-design templates (Task 2) — applied into cover_config, fully editable after. */
  coverTemplates?: BuilderCoverTemplate[];
  /** Active whole-album blueprints for THIS album size (0043) — the "Build it for me" workflow. */
  blueprints?: BuilderBlueprint[];
  /** When set, this album is a blueprint-editing draft (0046) — the builder enters Blueprint Mode. */
  blueprintDraftOf?: string | null;
  /** Blueprint identity for Blueprint-Mode chrome (0046) — only present in blueprint-edit mode. */
  blueprintMeta?: BlueprintMeta | null;
  stickerCatalog?: StickerCategory[];
  stickerUrls?: Record<string, string>;
}) {
  const router = useRouter();
  // Product geometry (Phase B) — provided by the parent DimensionsProvider. pageA = one page's
  // aspect (w/h), pairA = the open pair (2 × pageA). Every hardcoded 3:4 / 3:2 below now derives
  // from these, so the builder renders at the SAME proportions the print route prints at.
  const { page: pageA, pair: pairA, dims } = useBuilderDimensions();
  // Stamp the age of the server-rendered signed URLs at mount. They were minted moments before
  // this page rendered, so "now" is accurate to within the request — and it is what lets the
  // expiry-aware refresh (Phase 5) know when they need replacing, without touching the server.
  // `photos` now comes from the photo pipeline (declared below, once `api` exists).
  /**
   * THE SHARED UNDO TIMELINE.
   *
   * Two lanes hold genuinely different state — the layout (`useBlocks`) and image adjustments
   * (`usePhotoEditHistory`, which edits `photos.edit_config`) — and `useEditHistory` keeps the
   * ORDER they happened in, so one ⌘Z always undoes the last thing the customer actually did.
   * The ref indirection exists only because the two lanes are constructed after this line and
   * before the timeline can be; nothing else reads it.
   */
  const pushHistoryRef = useRef<(lane: 'blocks' | 'photos') => void>(() => {});
  const noteLayoutEntry = useCallback(() => pushHistoryRef.current('blocks'), []);
  const api = useBlocks(initialBlocks, pairA, noteLayoutEntry);
  const { blocks } = api;

  const [status, setStatus] = useState(initialStatus);
  const [review, setReview] = useState(initialReview);
  const [coverId, setCoverId] = useState<string | null>(initialCoverId);
  const [albumTitle, setAlbumTitle] = useState(title);
  const coverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Blueprint Mode opens on Layouts (blueprints carry no photos); customer albums open on Images.
  const [railTab, setRailTab] = useState<RailTab>(blueprintDraftOf ? 'layouts' : 'images');
  /**
   * Phone only: is the tool panel raised over the canvas? On desktop the panel is always beside
   * the canvas and this is ignored (the `max-md:` classes are the only readers). It starts closed
   * so a phone opens on the canvas — the thing being edited — rather than on a photo list.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  // Cover is page 0 of one continuous editor: `coverFocused` swaps the canvas + inspector to
  // the cover; `current` is the focused content spread otherwise.
  const [coverFocused, setCoverFocused] = useState(false);
  // Open the photo editor on the front/back cover image (crop/zoom/rotate stored in cover_config).
  const [coverImageEditor, setCoverImageEditor] = useState<CoverSide | null>(null);
  /**
   * What a photo picked from the modal should fill on the cover: the FACE's backdrop, or a
   * specific overlay frame on it. One piece of state for both, because it is one picker and one
   * decision — "which cover thing am I choosing a picture for?".
   */
  const [coverPhotoPicker, setCoverPhotoPicker] = useState<
    { side: CoverSide; target: 'image' } | { side: CoverSide; target: 'overlay'; overlayId: string } | null
  >(null);
  const [current, setCurrent] = useState(0);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [editLayout, setEditLayout] = useState<'focus' | 'grid'>('focus');
  const [zoomPct, setZoomPct] = useState(100);
  const [showGuides, setShowGuides] = useState(false);
  /**
   * Show the printed fold across every spread. A viewing preference, not album data — it changes
   * nothing that is saved or exported — so it lives with the rest of the per-device builder
   * context in localStorage. On by default: knowing where the fold falls is the sort of thing a
   * customer should have to turn OFF, not discover.
   */
  const [showGutter, setShowGutter] = useState(true);

  // ── Blueprint Mode (0046) — editing a reusable blueprint, not a customer album ──
  const blueprintMode = !!blueprintDraftOf;
  // Review Revision Mode (CHANGE 1): the album was reopened because our review team requested
  // changes (paid + review 'changes_requested'). Same builder engine, adapted chrome — a review
  // summary card, Resubmit-not-Checkout, and review-specific exit copy.
  const reviewMode = !blueprintMode && review?.status === 'changes_requested';
  // `blueprintSaving` / `exitDialogOpen` are owned by the blueprint-mode controller below.
  /**
   * THE PROPERTIES PANEL (Pass 3) — whether the docked right panel is open. The flag is
   * "sticky": it survives selection changes, so a user who works panel-open (the desktop-app
   * habit) sees each newly selected object's properties without re-opening anything. What the
   * panel SHOWS is derived from the selection; whether it shows at all is this one bit.
   */
  const [propsPanelOpen, setPropsPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false); // customer unsaved-changes guard
  const [resubmitted, setResubmitted] = useState(false); // review-mode resubmit confirmation
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Tray search + filters now live in `useTrayFilters` (composable axes), declared below.
  const [removingUnused, setRemovingUnused] = useState(false);

  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [quickCrop, setQuickCrop] = useState<{ photo: Photo; aspect: number; gutter: boolean } | null>(null);
  const [flipbookOpen, setFlipbookOpen] = useState(false);
  /** The physical page the preview was last showing — read once, on the way back to editing. */
  const previewPageRef = useRef<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  /** Distraction-free review (Phase 7). A view, never an editor — see `_review-mode`. */
  const [reviewOpen, setReviewOpen] = useState(false);

  // "Build it for me" → the 3-option Blueprint workflow (Full Auto / Choose / Custom) + its picker.
  const [buildMethodOpen, setBuildMethodOpen] = useState(false);
  const [bpPickerOpen, setBpPickerOpen] = useState(false);
  const [proposal, setProposal] = useState<{
    kind: LayoutKind;
    strategy: number;
    blocks: Block[];
    title: string;
    summary: ReturnType<typeof summarizePlan>;
  } | null>(null);

  // `saving` / `lastSaved` are owned by the save controller (declared below, once `api` exists).
  const [submitting, setSubmitting] = useState(false);
  // Submission validation (advisory, non-blocking): `checking` shows the "Checking your album…"
  // overlay while saves flush; `validation` holds the report that drives the informational dialog.
  const [checking, setChecking] = useState(false);
  const [validation, setValidation] = useState<AlbumValidationReport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /**
   * Where this spread sits in its curated layout cycle, plus the snapshot to return to. Cleared
   * whenever the spread is edited some other way, because "Original" would no longer mean the
   * thing the user remembers.
   */
  const [layoutCycle, setLayoutCycle] = useState<{ blockKey: string; original: Block; index: number } | null>(null);

  /**
   * THE PHOTO PIPELINE — optimistic photos, the upload manager's lifecycle, the progressive
   * poll, expiry-aware URL refresh and blob cleanup, all in one hook now SHARED with the
   * creation wizard.
   *
   * The builder supplies only the two things a LAYOUT-owning host must do that the wizard does
   * not: remap block references when an optimistic id becomes real, and strip a cancelled photo
   * from the pages it was placed on. Everything else is identical between the two surfaces, so
   * it lives in the pipeline rather than being copied.
   */
  const idMap = useIdMap();
  /**
   * The selection store and the favourites store are declared AFTER the pipeline (they need its
   * photo list), but the pipeline's confirm callback has to reach them. Late-bound refs keep the
   * declaration order honest without a circular dependency.
   */
  const selectionRemapRef = useRef<((from: string, to: string) => void) | null>(null);
  const favouritesRemapRef = useRef<((from: string, to: string) => void) | null>(null);
  /** Auto Create placements waiting on an upload — recorded by the wizard, replayed here. */
  const pendingPlacements = usePendingPlacements();
  const restorePendingRef = useRef<((tempId: string, realId: string, view?: Block[]) => void) | null>(
    null,
  );
  const restorePendingPlacement = (tempId: string, realId: string) =>
    restorePendingRef.current?.(tempId, realId);
  /** Labels follow the same late-bound remap contract as selection + favourites (Phase 7). */
  const labelsRemapRef = useRef<((from: string, to: string) => void) | null>(null);
  const pipeline = usePhotoPipeline({
    albumId,
    initialPhotos,
    onRemapId: (fromId, toId) => {
      idMap.register(fromId, toId);
      api.remapPhotoId(fromId, toId);
      setPickedId((cur) => (cur === fromId ? toId : cur));
      setEditingPhoto((cur) => (cur && cur.id === fromId ? { ...cur, id: toId } : cur));
      // A photo selected, favourited or MARKED while uploading keeps that state once it's real.
      selectionRemapRef.current?.(fromId, toId);
      favouritesRemapRef.current?.(fromId, toId);
      labelsRemapRef.current?.(fromId, toId);
      // Now that this photo is real, put it back where Auto Create meant it to go (if anywhere).
      restorePendingPlacement(fromId, toId);
    },
    onPhotoDropped: (photoId) => {
      idMap.forget(photoId);
      api.removePhotoEverywhere(photoId);
      setPickedId((cur) => (cur === photoId ? null : cur));
      setEditingPhoto((cur) => (cur && cur.id === photoId ? null : cur));
      // A cancelled upload will never become a photo — drop its reserved spot too.
      pendingPlacements.remove(albumId, photoId);
    },
  });
  const { photos, setPhotos, uploads, taskFor, photoStateFor, reportFailure } = pipeline;

  // Live mirror for the builder's own async readers (layout verification, blob cleanup on
  // delete). The pipeline keeps its own; this one serves the layout side.
  const photosRef = useRef<Photo[]>(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Tracks whether the layout on screen was built from browser-measured shapes, and reconciles
  // it once the worker's authoritative dimensions arrive (Phase 4).
  const optimisticLayout = useOptimisticLayout();
  const blocksRef = useRef<Block[]>(api.blocks);
  blocksRef.current = api.blocks;

  /**
   * RESTORE ONE AUTO CREATE PLACEMENT, now that its upload has a real photo id.
   *
   * Auto Create may have arranged photos that were still uploading. Their positions could not be
   * persisted (a temp id is not a photo the server has), so the wizard recorded the coordinates
   * and this replays them one photo at a time, as each id becomes real. Deliberately NOT a
   * re-run of Auto Create: the original arrangement is restored exactly, rather than recomputed
   * against a photo set and dimension picture that have since moved on.
   *
   * NEVER OVERWRITES THE CUSTOMER. The recorded slot is taken only if it is still EMPTY; if the
   * user has since put something there (or reworked the page), the photo is left in the tray for
   * them to place. Losing an automatic placement is a small miss; overwriting deliberate work is
   * not. A free slot elsewhere in the same block is accepted as a fallback, which keeps the photo
   * on its intended page when a neighbour happened to resolve first.
   *
   * Keyed by temp id, so photos confirming out of order each still find their own spot.
   *
   * `view` is the block list to decide against, and the caller may pass its own so that SEVERAL
   * restorations resolved in one pass see each other's work. React state is one render behind
   * inside a loop, and two photos reading the same stale page both conclude the same slot is free
   * — the second silently replacing the first. The caller that restores in bulk therefore keeps a
   * projection and this function updates it in step with the mutation it issues.
   */
  const restorePending = useCallback(
    (tempId: string, realId: string, view?: Block[]) => {
      const waiting = pendingPlacements.get(albumId);
      const pending = waiting.find((p) => p.tempPhotoId === tempId);
      if (!pending) return;
      pendingPlacements.remove(albumId, tempId);

      const blocks = view ?? blocksRef.current;
      /**
       * ALREADY PLACED = ALREADY DECIDED. The tray accepts optimistic photos, so the customer can
       * drag a still-uploading one onto a page themselves. Restoring it afterwards would MOVE it
       * (every assignment strips the photo from its previous frame first) — taking a deliberate
       * placement away and calling it a restoration. If the photo is anywhere in the layout, under
       * either id, the intent is spent.
       */
      const placed = blocks.some(
        (b) =>
          b.photoIds.some((id) => id === realId || id === tempId) ||
          b.overlays.some((o) => o.photoId === realId || o.photoId === tempId),
      );
      if (placed) return;

      const at = pending.blockIndex;
      const block = blocks[at];
      if (!block) return; // the page is gone — the user restructured; leave the photo in the tray
      const blockKey = block.key;
      const baseCapacity = block.template === 'double-spread' ? 1 : 2;

      /** Write base slots wholesale, so a hole can be filled without disturbing its neighbour. */
      const putBase = (photoIds: (string | null)[]) => {
        const next = trimBaseIds(photoIds);
        api.patchBlock(blockKey, { photoIds: next });
        if (view) view[at] = { ...block, photoIds: next };
      };
      /** This block's base row padded to its full capacity, so a slot index is always addressable. */
      const baseRow = (): (string | null)[] =>
        Array.from({ length: baseCapacity }, (_, i) => block.photoIds[i] ?? null);
      const putOverlay = (overlayId: string) => {
        api.replaceOverlay(blockKey, overlayId, realId);
        if (view) {
          view[at] = {
            ...block,
            overlays: block.overlays.map((o) => (o.id === overlayId ? { ...o, photoId: realId } : o)),
          };
        }
      };

      if (pending.slot.kind === 'base') {
        /**
         * ORDER SURVIVES OUT-OF-ORDER CONFIRMATION, and now it does so trivially.
         *
         * Base slots used to compact, so a photo landing while an earlier neighbour was still
         * uploading could not be put where it belonged — it had to be INSERTED at a position that
         * discounted whatever was still in flight, and the arithmetic only worked because every
         * late arrival shifted the rest along. Slots are positional now, so the recorded index IS
         * the destination: each photo lands where Auto Create put it, in any delivery order, and a
         * neighbour that never arrives simply leaves its own slot empty instead of dragging the
         * others across.
         */
        const idx = pending.slot.index;
        if (idx < baseCapacity && !block.photoIds[idx]) {
          const next = baseRow();
          next[idx] = realId;
          putBase(next);
          return;
        }
      } else {
        const overlay = block.overlays[pending.slot.index];
        // `id` is assigned on load (withOverlayIds); an overlay without one cannot be addressed.
        if (overlay?.id && !overlay.photoId) {
          putOverlay(overlay.id);
          return;
        }
      }

      // Preferred slot taken — the user has been working here. Any other free slot on the SAME
      // page still keeps the photo where it was meant to be, page-wise. Try the kind it was
      // arranged as first, so an overlay stays an overlay when a spare one exists.
      const takeFreeOverlay = () => {
        const free = block.overlays.find((o) => o.id && !o.photoId);
        if (!free?.id) return false;
        putOverlay(free.id);
        return true;
      };
      const takeFreeBase = () => {
        const next = baseRow();
        const free = next.findIndex((id) => !id);
        if (free < 0) return false;
        next[free] = realId;
        putBase(next);
        return true;
      };
      if (pending.slot.kind === 'overlay') {
        if (takeFreeOverlay() || takeFreeBase()) return;
      } else if (takeFreeBase() || takeFreeOverlay()) return;
      // Nothing free — the page is full of the user's own choices. The photo stays in the tray.
    },
    [albumId, api, pendingPlacements],
  );
  restorePendingRef.current = restorePending;

  /**
   * THE OTHER HALF OF RESTORATION: uploads that confirmed BEFORE this builder existed.
   *
   * `onRemapId` only fires for a photo that is still optimistic *here* — but an upload can land
   * during the wizard's save or mid-navigation, in which case the wizard's pipeline did the remap
   * and the builder mounts with a plain real photo and no event to hang restoration off. Those
   * placements would be silently dropped.
   *
   * So the pending list is also swept against what is actually known: the manager's task table
   * (session-scoped, so it still holds the temp → real mapping) intersected with photos the album
   * really has. Runs whenever either changes, which also covers a photo that confirms while the
   * builder is open but outside the remap path. `restorePending` removes each entry as it goes,
   * so this and `onRemapId` can never place the same photo twice.
   */
  useEffect(() => {
    const waiting = pendingPlacements.get(albumId);
    if (waiting.length === 0) return;
    const known = new Set(photos.map((p) => p.id));
    // A projection of the pages, updated as each placement lands, so a whole batch of restorations
    // can resolve in one pass without any of them deciding against pre-batch state.
    const view = [...blocksRef.current];
    for (const p of waiting) {
      const realId = uploads.taskByTempPhotoId.get(p.tempPhotoId)?.photoId;
      // Not confirmed yet, or the row hasn't reached this page — leave it pending.
      if (!realId || !known.has(realId)) continue;
      restorePendingRef.current?.(p.tempPhotoId, realId, view);
    }
  }, [albumId, photos, uploads.taskByTempPhotoId, pendingPlacements]);

  /**
   * MEMORY AUDIT (Phase 5). The debounced cover save was the one timer in the builder with no
   * cleanup: leaving the page mid-debounce left a pending `saveCoverDesign` that would fire
   * after unmount — a stray write and a retained closure over the whole cover config. Cancelling
   * it on unmount is safe because every intentional save path already flushes it first.
   */
  useEffect(
    () => () => {
      if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
    },
    [],
  );

  // Release any local preview still held when the builder unmounts (route change / exit).
  // Skips previews the upload manager still owns (temp ids) — those outlive this page now, and
  // revoking them here would blank the tile on whichever surface the upload lands in. Same
  // ownership rule as the pipeline's cleanup; see `_use-photo-pipeline`.
  useEffect(
    () => () => {
      for (const p of photosRef.current) {
        if (isTempPhotoId(p.id)) continue;
        revokeLocalPreview(p.localUrl);
      }
    },
    [],
  );

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const placed = useMemo(() => placedPhotoIds(blocks), [blocks]);
  /**
   * Photos that can be put on a page right now. Phase 3 widens this from "processed" to
   * "has something to draw", which is what makes optimistic placement work — an uploading
   * photo shows its own blob. `isPlaceable` still excludes failures and previews the browser
   * cannot decode (HEIC), so a slot is never filled with nothing.
   */
  const availablePhotos = useMemo(
    () => photos.filter((p) => !placed.has(p.id) && isPlaceable(p, photoUiState(p, taskFor(p.id)))),
    [photos, placed, taskFor],
  );
  const availableIds = useMemo(() => availablePhotos.map((p) => p.id), [availablePhotos]);
  /** Still-uploading photos — the reason some metadata-driven tools stay unavailable. */
  const unprocessedCount = useMemo(() => photos.filter((p) => p.status !== 'ready').length, [photos]);
  const selectedCover = useMemo(() => covers.find((c) => c.id === coverId) ?? null, [covers, coverId]);

  // Sticker URL resolver — active catalog ∪ referenced (resolved server-side so a deactivated but
  // already-placed sticker still renders). New stickers added from the panel resolve via catalog.
  const stickerUrlMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const cat of stickerCatalog) for (const s of cat.stickers) m.set(s.id, s.url);
    for (const [id, url] of Object.entries(stickerUrls)) m.set(id, url);
    return m;
  }, [stickerCatalog, stickerUrls]);
  const stickerUrlFor = useCallback((id: string) => stickerUrlMap.get(id), [stickerUrlMap]);

  const consumed = pagesConsumed(blocks);
  const remaining = size - consumed;
  const cur = Math.min(current, Math.max(0, blocks.length - 1));
  const block = blocks[cur];

  // A layout cycle belongs to ONE spread: leaving it ends the rotation, so "Original" can never
  // refer to a spread the user is no longer looking at.
  const focusedKey = block?.key;
  useEffect(() => {
    setLayoutCycle((c) => (c && c.blockKey === focusedKey ? c : null));
  }, [focusedKey]);
  const canAddMore = remaining >= 2;

  // Reset element selection whenever the focused spread changes.
  useEffect(() => setSelection(NO_SELECTION), [cur, blocks.length]);

  /**
   * ONE exception to that reset: arriving at a spread BECAUSE a quality issue pointed there.
   *
   * The reset above is right for ordinary navigation — paging to spread 4 shouldn't leave you
   * editing spread 3's overlay. But "take me to the problem" means landing with the problem
   * already selected, and the reset would undo that on the very next commit. So the intent is
   * queued in a ref and applied by an effect declared AFTER the reset, which is what guarantees
   * it wins without weakening the reset for every other caller.
   */
  const pendingFrameSel = useRef<Selection | null>(null);
  useEffect(() => {
    if (!pendingFrameSel.current) return;
    setSelection(pendingFrameSel.current);
    pendingFrameSel.current = null;
  }, [cur, blocks.length]);

  // The fixed crop frame for the editing photo matches WHERE it is placed (WYSIWYG).
  const editPlacement = useMemo(() => {
    const fallback = { aspect: pageA, gutter: false };
    if (!editingPhoto) return fallback;
    for (const b of blocks) {
      if (b.photoIds[0] === editingPhoto.id || b.photoIds[1] === editingPhoto.id) {
        return b.template === 'double-spread' ? { aspect: pairA, gutter: true } : { aspect: pageA, gutter: false };
      }
      const ov = b.overlays.find((o) => o.photoId === editingPhoto.id);
      // Overlay pixel aspect = (ov.w / ov.h) × pair aspect (the pair is pairA× wider than tall).
      if (ov && ov.h > 0) return { aspect: (ov.w * pairA) / ov.h, gutter: false };
    }
    return fallback;
  }, [editingPhoto, blocks, pageA, pairA]);

  // Warn before leaving with unsaved changes — browser refresh / tab-close / window-close (CHANGE 4).
  useEffect(() => {
    if (!api.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [api.dirty]);

  // Back-button guard (CHANGE 4/15): trap the browser Back press while there are unsaved changes and
  // open the guard dialog instead of navigating away. IMPROVED history hygiene — exactly ONE sentinel
  // is ever pushed (a ref guards it), and the listener reads the LIVE dirty state via a ref, so
  // editing→saving→editing cycles no longer stack extra history entries. Not used in Blueprint Mode.
  const dirtyRef = useRef(api.dirty);
  useEffect(() => {
    dirtyRef.current = api.dirty;
  }, [api.dirty]);
  const sentinelPushed = useRef(false);
  useEffect(() => {
    if (blueprintMode) return;
    if (!sentinelPushed.current) {
      window.history.pushState(null, '', window.location.href);
      sentinelPushed.current = true;
    }
    const onPop = () => {
      if (!dirtyRef.current) return; // clean → let the back proceed
      window.history.pushState(null, '', window.location.href); // re-arm the single sentinel
      setMessage(null);
      setExitConfirmOpen(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [blueprintMode]);

  // ── Resume where the user left off (CHANGE 6) — persist the builder UI CONTEXT (current spread,
  // open rail, cover focus) per album in localStorage and restore it on re-entry, so reopening an
  // album lands the user exactly where they were. Content itself is already restored from the DB;
  // this only restores the transient view state. Blueprint Mode is excluded (its own workflow). ──
  const ctxKey = `ms-builder-ctx:${albumId}`;
  useEffect(() => {
    if (blueprintMode) return;
    try {
      const raw = localStorage.getItem(ctxKey);
      if (!raw) return;
      const s = JSON.parse(raw) as { current?: number; railTab?: RailTab; coverFocused?: boolean; showGutter?: boolean };
      if (typeof s.showGutter === 'boolean') setShowGutter(s.showGutter);
      const cf = s.coverFocused === true;
      setCoverFocused(cf);
      let rt: RailTab = s.railTab && RAIL.some((r) => r.key === s.railTab) ? s.railTab : 'images';
      if (cf && rt === 'layouts') rt = 'images'; // layouts is content-only
      if (!cf && rt === 'templates') rt = 'images'; // templates is cover-only
      setRailTab(rt);
      if (typeof s.current === 'number' && Number.isFinite(s.current)) {
        setCurrent(Math.min(Math.max(0, Math.floor(s.current)), Math.max(0, api.blocks.length - 1)));
      }
    } catch {
      /* corrupt/unavailable storage — start fresh */
    }
    // Restore ONCE on mount for this album.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, blueprintMode]);

  useEffect(() => {
    if (blueprintMode) return;
    try {
      localStorage.setItem(ctxKey, JSON.stringify({ current, railTab, coverFocused, showGutter }));
    } catch {
      /* storage full/unavailable — non-fatal */
    }
  }, [ctxKey, current, railTab, coverFocused, showGutter, blueprintMode]);

  // Polling, reconciliation, the blob handoff and the processing counts all live in the photo
  // pipeline now — these are just the values this component renders from. (`oldestProcessingSince`
  // fed the escalating "Processing → Enhancing → Almost there" copy, which the upload-clarity
  // pass removed; the pipeline still tracks it, nothing in the UI asks for it any more.)
  const { pendingPhotos, rejectedPhotos } = pipeline;

  /**
   * IDLE PRELOAD (Phase 5) — warm the photos on the neighbouring spreads so moving between
   * pages is instant. Paused entirely while anything is uploading: a speculative fetch must
   * never compete with a transfer the user actually asked for.
   */
  const neighbourUrls = useMemo(() => {
    const wanted: string[] = [];
    for (const offset of [1, -1, 2]) {
      const b = blocks[cur + offset];
      if (!b) continue;
      for (const id of b.photoIds) {
        const url = id ? resolvePhotoUrl(photoMap.get(id), 'full') : null;
        if (url && !url.startsWith('blob:')) wanted.push(url);
      }
      for (const o of b.overlays) {
        const url = o.photoId ? resolvePhotoUrl(photoMap.get(o.photoId), 'full') : null;
        if (url && !url.startsWith('blob:')) wanted.push(url);
      }
    }
    return wanted;
  }, [blocks, cur, photoMap]);
  useIdlePreload(neighbourUrls, uploads.stats.inFlight > 0);

  // ── tray ───────────────────────────────────────────────────────────────────
  const readyUnplaced = photos.filter((p) => p.status === 'ready' && !placed.has(p.id));

  /**
   * Photo indicators (capacity / placed / remaining / unused), derived from existing state only.
   *
   * "Remaining slots" counts FRAMES WAITING FOR A PHOTO — overlay containers the customer placed
   * and has not filled. It used to count unfilled base halves, which described the old model where
   * every spread demanded two photos; a page is a background now, so an empty half is a finished
   * design and counting it would tell the customer they are permanently behind.
   */
  const placedCount = placed.size;
  const emptyBaseSlots = blocks.reduce((s, b) => s + b.overlays.filter((o) => !o.photoId).length, 0);
  // Layout CAPACITY = the photos this arrangement actually holds: filled base images + every
  // overlay frame, empty or not.
  const totalSlots = blocks.reduce((s, b) => s + b.photoIds.filter(Boolean).length + b.overlays.length, 0);
  /**
   * TRAY FILTERING (Phase 6) — independent axes combined with AND, so "unplaced" and "portrait"
   * and "favourites" can all be on at once. The result is a plain array, so the virtual grid
   * windows it exactly as before; filtering never touches virtualization.
   */
  const favourites = useFavourites(albumId);
  /** Triage marks (Phase 7) — a client-side working aid, exactly like favourites above. */
  const labels = useLabels(albumId);
  const trayFilterCtx = useMemo(
    () => ({
      isPlaced: (id: string) => placed.has(id),
      stateOf: (p: Photo) => photoUiState(p, taskFor(p.id)),
      isFavourite: favourites.isFavourite,
      labelOf: labels.labelOf,
    }),
    [placed, taskFor, favourites.isFavourite, labels.labelOf],
  );
  const tray = useTrayFilters(photos, trayFilterCtx);
  const visiblePhotos = tray.visible;
  // Live read for the marquee's geometric hit test, which maps indices back to photos.
  const visiblePhotosRef = useRef<Photo[]>(visiblePhotos);
  visiblePhotosRef.current = visiblePhotos;

  // ── cover ─────────────────────────────────────────────────────────────────────
  // Persist the whole cover design (debounced) — title + base template + config jsonb.
  const persistCover = useCallback(
    (next: { title: string; coverId: string | null; config: CoverConfig }) => {
      if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
      coverSaveTimer.current = setTimeout(async () => {
        // Runs whatever the title is. A blank title is not an error and no longer suppresses the
        // write — the server simply leaves `albums.title` untouched and still persists the config,
        // so a background/element edit is never lost just because the cover line is empty.
        const res = await saveCoverDesign({ albumId, title: next.title, coverTemplateId: next.coverId, config: next.config });
        if (!res.ok) setMessage({ kind: 'err', text: res.error });
      }, 500);
    },
    [albumId],
  );

  /**
   * THE COVER, AS A CANVAS (Cover Editor 2.0).
   *
   * `useCover` owns the whole surface the way `useBlocks` owns pages — history, selection,
   * object mutations and the metadata binding. What used to be ~200 lines of bespoke handlers on
   * this component (`writeSide`, `patchCoverText`, `duplicateCoverSticker`, …) and a
   * `CoverSelection` union nothing else understood is gone; the cover now speaks the builder's
   * own `Selection`, so the shared toolbars and shortcuts work on it without knowing it exists.
   *
   * Persistence is deliberately unchanged: every change lands in the same debounced
   * `saveCoverDesign` call this component already made.
   */
  const coverIdRef = useRef(coverId);
  coverIdRef.current = coverId;

  /**
   * `commands.applyPhotoEdit` reached through a ref, because `useCover` is constructed BEFORE the
   * command layer (the cover's own state is one of the command layer's inputs). The functions
   * below are called from user events, long after both exist.
   *
   * Why the cover needs it at all: a cover OVERLAY is an ordinary album photo in a frame, so its
   * crop and rotation belong on the `photos` row exactly as a page overlay's do — not in
   * `cover_config.imageEdit`, which describes the face's backdrop.
   */
  const applyPhotoEditRef = useRef<((photoId: string, patch: Partial<EditConfig>) => void) | null>(null);

  const cover = useCover({
    initialConfig: initialCoverConfig,
    title,
    pageAspect: pageA,
    onPhotoEdit: useCallback((photoId: string, patch: Partial<EditConfig>) => {
      applyPhotoEditRef.current?.(photoId, patch);
    }, []),
    onPhotoRotate: useCallback((photoId: string, dir: 1 | -1) => {
      const cur = photosRef.current.find((p) => p.id === photoId)?.edit?.rotate ?? 0;
      applyPhotoEditRef.current?.(photoId, { rotate: (((cur + dir * 90 + 360) % 360) as 0 | 90 | 180 | 270) });
    }, []),
    onChange: useCallback(
      ({ config, title: nextTitle }: { config: CoverConfig; title: string }) =>
        persistCover({ title: nextTitle, coverId: coverIdRef.current, config }),
      [persistCover],
    ),
    // The canvas renamed the album — keep the header, the settings dialog and validation in step
    // with what the cover now says. This is the write half of the two-way metadata binding.
    onTitleChange: setAlbumTitle,
  });
  const coverConfig = cover.config;

  /** Choose the base cover artwork (an admin template) — the one cover write that isn't an object. */
  const setCoverTemplate = (id: string | null, config?: Partial<CoverConfig>) => {
    setCoverId(id);
    if (config) cover.update(config);
    else persistCover({ title: albumTitle, coverId: id, config: cover.config });
  };

  /**
   * ── ALBUM QUALITY (Phase 7) ───────────────────────────────────────────────────
   *
   * One derivation, consumed by four surfaces: the Quality panel, the per-frame badges on the
   * canvas, the dots on the page strip, and the overlay in review mode. Computing it four times
   * would be four chances to disagree, so it is computed ONCE here and passed down as lookups.
   *
   * `stateOf` is derived from `photoMap` rather than the pipeline's ref-based `photoStateFor`,
   * because a memo needs an input that actually changes when the photos do — a ref read inside
   * `useMemo` would silently go stale for exactly one render, which is the render that matters.
   */
  const stateOf = useCallback(
    (photoId: string) => {
      const p = photoMap.get(photoId);
      return p ? photoUiState(p, taskFor(p.id)) : undefined;
    },
    [photoMap, taskFor],
  );
  // The album's printed pair width in inches — what turns "2400px wide" into "prints at 190 dpi".
  const pairWidthIn = useMemo(() => pairWidthInches(dims.printWidthCm), [dims.printWidthCm]);

  const quality = useMemo(
    () =>
      inspectAlbum({
        blocks,
        photos,
        photoState: stateOf,
        cover: { config: coverConfig, templateId: coverId },
        pairAspect: pairA,
        pairWidthIn,
      }),
    [blocks, photos, stateOf, coverConfig, coverId, pairA, pairWidthIn],
  );
  const statistics = useMemo(
    () => albumStatistics({ blocks, photos, photoState: stateOf }),
    [blocks, photos, stateOf],
  );
  const readinessOf = useCallback((key: string) => quality.readiness.get(key), [quality.readiness]);

  /**
   * ── CANVAS-FIRST EDITING (Pass 2) ─────────────────────────────────────────────
   *
   * Three pieces of state, all of them about WHERE editing happens rather than what it does:
   * the page element the floating bar anchors against, the frame currently being cropped
   * in-canvas, and the frame waiting on the photo picker. None of them touch the layout model,
   * history, or the save pipeline — they are pure view state.
   */
  const pageElRef = useRef<HTMLDivElement | null>(null);
  /**
   * Which EXISTING frame the photo picker is open for — a base slot or an overlay.
   *
   * There is no "create an overlay from the chosen photo" destination any more: adding a frame
   * and filling it are two separate steps now (see `addPageOverlay`), so the picker only ever
   * fills something that already exists.
   */
  const [pickerFor, setPickerFor] = useState<{ kind: 'base'; slot: BaseSlot } | { kind: 'overlay'; overlayId: string } | null>(
    null,
  );
  // (`useCanvasCrop` is set up below, once the photo-write callbacks it drives exist.)

  /** Which layouts this photographer reaches for — remembered across albums, on this device. */
  const layoutMemory = useLayoutMemory();

  /**
   * THE IMAGE-ADJUSTMENT LANE. Undo/redo for crop, zoom, rotation, flip and tone — state that
   * lives on `photos.edit_config` rather than in `Block[]`, and was therefore outside ⌘Z until
   * now. Applying a step writes local state AND persists, so undo survives a reload exactly as
   * the original edit does.
   */
  const photoEdits = usePhotoEditHistory(
    useCallback((photoId: string, e: EditConfig) => {
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, edit: e } : p)));
      void savePhotoEdit({ photoId, edit: e });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /** The two lanes, in the order the customer edited them. See `_use-edit-history`. */
  const history = useEditHistory({
    blocks: { canUndo: api.canUndo, canRedo: api.canRedo, undo: api.undo, redo: api.redo },
    photos: { canUndo: photoEdits.canUndo, canRedo: photoEdits.canRedo, undo: photoEdits.undo, redo: photoEdits.redo },
  });
  pushHistoryRef.current = history.push;
  // Stable by construction (see `_use-edit-history`) — pulled out so the keyboard table can name
  // them without naming `history`, whose identity changes whenever either stack changes depth.
  const { undo: undoEdits, redo: redoEdits } = history;

  // ── photos ─────────────────────────────────────────────────────────────────
  const onPhotoDeleted = (id: string) => {
    // Release the local preview (if any) before the row leaves state — nothing can show it
    // afterwards, so this is the last safe moment.
    revokeLocalPreview(photosRef.current.find((p) => p.id === id)?.localUrl);
    api.removePhotoEverywhere(id);
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const removeUnused = async () => {
    const targets = photos.filter((p) => p.status === 'ready' && !placed.has(p.id));
    if (targets.length === 0) return;
    if (!confirm(`Remove ${targets.length} unused photo${targets.length === 1 ? '' : 's'} from the album?`)) return;
    setRemovingUnused(true);
    for (const t of targets) {
      try {
        const res = await fetch(`/api/photos/${t.id}`, { method: 'DELETE' });
        if (res.ok) onPhotoDeleted(t.id);
      } catch {
        /* skip */
      }
    }
    setRemovingUnused(false);
  };

  /**
   * THE LIVE HALF of every adjustment: patch local photo state so the canvas updates on the same
   * frame. It also opens a history entry (`markLive` records what the edit was BEFORE the gesture
   * started, once per gesture), which is what makes crop, zoom and the tone sliders undoable
   * without any of them growing their own bookkeeping.
   */
  const patchPhotoLocal = useCallback(
    (photoId: string, edit: EditConfig) => {
      photoEdits.markLive(photoId, photosRef.current.find((p) => p.id === photoId)?.edit ?? null);
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, edit } : p)));
    },
    // `photoEdits` is a stable object of stable callbacks; `setPhotos` is a React setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * THE COMMIT HALF: close the history entry. The modal editors have already persisted by the
   * time they call this, so persistence is the caller's business and this only records.
   */
  const closePhotoEdit = useCallback(
    (photoId: string, edit: EditConfig) => {
      if (photoEdits.commit(photoId, edit)) pushHistoryRef.current('photos');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Modal editor / quick crop: they persist themselves, so sync local state and close the entry. */
  const onPhotoSaved = useCallback(
    (photoId: string, edit: EditConfig) => {
      patchPhotoLocal(photoId, edit);
      closePhotoEdit(photoId, edit);
    },
    [patchPhotoLocal, closePhotoEdit],
  );

  /** Live + persist + record — the shape every non-modal adjustment surface uses. */
  const commitPhotoEdit = useCallback(
    (photoId: string, edit: EditConfig) => {
      void savePhotoEdit({ photoId, edit });
      closePhotoEdit(photoId, edit);
    },
    [closePhotoEdit],
  );

  /**
   * IN-CANVAS IMAGE ADJUSTMENT — available on EVERY photo frame: both page slots, a full-spread
   * image, and every overlay whatever its shape. Reuses `EditConfig`'s zoom/offset fields and the
   * existing `frameOverflow` maths (see `_use-canvas-crop` for why this is a relocation of the
   * Quick Crop gesture rather than a second crop implementation), and it drives exactly the pair
   * above — `patchPhotoLocal` per frame, `commitPhotoEdit` on release — so an adjustment is
   * live, persisted and undoable without this surface knowing anything about any of the three.
   *
   * Both callbacks are stable, which matters here: they are handed to a canvas that re-renders on
   * every frame of a drag, and churning their identity would invalidate its props each time.
   */
  const crop = useCanvasCrop({
    photoFor: useCallback((id: string) => photoMap.get(id), [photoMap]),
    onChange: patchPhotoLocal,
    onCommit: commitPhotoEdit,
  });

  // ── Phase 6: selection + commands ─────────────────────────────────────────────
  /**
   * Bulk photo removal used by the `deletePhotos` command. Optimistic photos have no server row,
   * so they are CANCELLED through the upload manager; real ones go through the same
   * `DELETE /api/photos/:id` the tray has always used. No new backend interaction.
   */
  const deletePhotoIds = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        const task = uploads.taskByTempPhotoId.get(id);
        if (task) {
          uploads.cancel(task.id); // optimistic — abort, don't DELETE
          continue;
        }
        try {
          const res = await fetch(`/api/photos/${id}`, { method: 'DELETE' });
          if (res.ok) {
            revokeLocalPreview(photosRef.current.find((p) => p.id === id)?.localUrl);
            setPhotos((prev) => prev.filter((p) => p.id !== id));
          }
        } catch {
          /* transient — the photo stays; the user can retry */
        }
      }
    },
    [uploads, setPhotos],
  );

  /** Every selectable target in visual order — the domain Select All and Shift-range act on. */
  const allTargets = useCallback((): SelectionTarget[] => {
    const out: SelectionTarget[] = photos.map((p) => ({ kind: 'photo', photoId: p.id }));
    for (const b of blocks) {
      // Only slots the spread actually exposes — a background-only page has none, and Select All
      // must not hand the command layer frames the canvas does not draw.
      for (const slot of activeBaseSlots(b)) out.push({ kind: 'base', blockKey: b.key, slot });
      for (const o of b.overlays) if (o.id) out.push({ kind: 'overlay', blockKey: b.key, id: o.id });
    }
    return out;
  }, [photos, blocks]);

  const sel = useSelection({ blocks, photos });
  // Stable adapters between the label / favourite stores and the command layer. They change
  // only when the underlying stores actually change, which is what keeps the command registry
  // memoized (see the note where they are passed in).
  const { labelOf, setLabel, toggleLabel } = labels;
  const labelCommandApi = useMemo(
    () => ({ labelOf, toggle: toggleLabel, clear: (ids: readonly string[]) => setLabel(ids, null) }),
    [labelOf, toggleLabel, setLabel],
  );
  const favouriteCommandApi = useMemo(
    () => ({ isFavourite: favourites.isFavourite, toggle: favourites.toggle }),
    [favourites.isFavourite, favourites.toggle],
  );
  /**
   * Which spread is focused and what is selected ON it. Memoized for the same reason as the two
   * adapters above: `useCommands` keys its registry on this, so a fresh literal each render
   * would rebuild every command on every render.
   *
   * `blockKey` is null while the cover is focused — the cover has its own element model
   * (`coverSel`) and its own delete controls, so the ladder simply doesn't apply there.
   */
  const clearElementSelection = useCallback(() => setSelection(NO_SELECTION), []);
  const deleteFocus = useMemo(
    () => ({
      blockKey: coverFocused ? null : (block?.key ?? null),
      element: selection,
      clearElement: clearElementSelection,
    }),
    [coverFocused, block?.key, selection, clearElementSelection],
  );
  const cmd = useCommands({
    api,
    blocks,
    photos,
    selection: sel.selection,
    setSelection: sel.setSelection,
    allTargets,
    deletePhotoIds,
    /* Undo/redo spans both lanes — the registry must reach the same stack the keyboard does. */
    history,
    savePhotoEdit: commitPhotoEdit,
    patchPhotoEdit: patchPhotoLocal,
    albumSize: size,
    onMessage: setMessage,
    /**
     * Phase 7: marks and stars become COMMANDS rather than tray-only buttons, so the keyboard,
     * the context menu and the selection bar all reach the same implementation — the reason
     * this layer exists at all. Both adapters are MEMOIZED: `useCommands` keys its registry on
     * them, so a fresh object literal here would rebuild every command on every render and
     * re-render the selection bar for nothing.
     */
    labels: labelCommandApi,
    favourites: favouriteCommandApi,
    onDuplicatedPreset: layoutMemory.markDuplicated,
    /**
     * The focused spread + its single-element selection. Delete needs both stores to resolve
     * what the user actually means (see `deleteSelection` in the command layer) — text, stickers
     * and QR only ever live in this one, while overlays can be multi-selected across pages.
     */
    focus: deleteFocus,
  });

  /* Publish the photo-edit command to the cover, which was constructed before this layer. */
  useEffect(() => {
    applyPhotoEditRef.current = cmd.applyPhotoEdit;
  }, [cmd.applyPhotoEdit]);

  const contextMenu = useContextMenu();

  /**
   * REPLACE ON DROP — placement on the canvas, with the swap narrated.
   *
   * Every canvas placement (drop on a base slot, drop on an overlay, pick from the modal) comes
   * through here so the behaviour is described once. The placement itself is the existing
   * `commands.placePhoto` — one `api.batch`, so a replacement is a SINGLE undo entry, dirty-marks
   * the album like any other edit, and rides the existing debounced save. Nothing new is written.
   *
   * What is added is the sentence. `assignBaseSlot` / `replaceOverlay` displace the previous
   * occupant by simply no longer referencing it, and the tray is derived from "not referenced
   * anywhere" — so the old photo is already back in the tray by the next render, with its own
   * edits intact. That is silent unless someone says so, and a photo quietly vanishing from a
   * page is exactly the kind of thing a customer reads as data loss. Hence one quiet line, and
   * still no dialog, no confirm, no extra click.
   */
  const placeOnCanvas = useCallback(
    (photoId: string, target: { blockKey: string; slot?: BaseSlot; overlayId?: string }) => {
      const b = blocks.find((x) => x.key === target.blockKey);
      const displaced = !b
        ? undefined
        : target.overlayId
          ? b.overlays.find((o) => o.id === target.overlayId)?.photoId ?? undefined
          : b.photoIds[target.slot === 'right' ? 1 : 0];

      cmd.placePhoto(photoId, target);

      if (displaced && displaced !== photoId) {
        const name = photoMap.get(displaced)?.filename;
        setMessage({
          kind: 'ok',
          text: name ? `Replaced — “${name}” is back in your tray.` : 'Replaced — the previous photo is back in your tray.',
        });
      }
    },
    [blocks, cmd, photoMap],
  );

  /**
   * ── WHERE THE CONTEXT BAR POINTS ───────────────────────────────────────────────
   *
   * The selected element's NORMALIZED rect. Every canvas object already stores one, so resolving
   * the bar's anchor is a lookup rather than a measurement — no `getBoundingClientRect` per
   * element, no ResizeObserver per element. With nothing selected the bar anchors to the whole
   * spread, which is what makes the page toolbar appear "at the page".
   */
  /**
   * The cover's answer to the same question. `pageElRef` follows the FOCUSED FACE (the canvas
   * publishes it), so the identical anchor hook positions the identical bar — the cover needed no
   * second measurement path, only a rect.
   */
  /**
   * WHERE THE TOOLBAR STACK SITS — the SPREAD, not the selection.
   *
   * It used to follow whatever was selected, so the bar leapt across the canvas on every click.
   * That was tolerable while it was a single bar that appeared and disappeared with the object it
   * described; it is not, now that the page row is permanent — a persistent toolbar that teleports
   * is worse than one that vanishes. Anchoring to the spread makes the page row genuinely fixed:
   * the ONLY movement in the whole system is the upward shift when the contextual row appears
   * beneath it, which is the motion the design calls for and nothing else.
   *
   * The same rect serves the cover, whose faces share one anchor box for the same reason.
   */
  const barAnchor = useAnchorRect(
    pageElRef,
    (coverFocused || (!!block && editLayout === 'focus')) ? FULL_PAGE : null,
  );

  /**
   * The selected OVERLAY's box — the one selection whose tools follow the object (see `ContextBar`).
   *
   * Memoized on the overlay itself, so the anchor is recomputed exactly when the overlay's
   * geometry changes and not once more. During a drag that is every frame, which is precisely
   * what makes the toolbar track it; when nothing is moving the rect keeps its identity and the
   * measurement hook stays idle.
   */
  const overlayRect = useMemo<NormRect | null>(() => {
    if (coverFocused || editLayout !== 'focus' || !block || selection.kind !== 'overlay') return null;
    return block.overlays.find((o) => o.id === selection.id) ?? null;
  }, [coverFocused, editLayout, block, selection]);
  const overlayAnchor = useAnchorRect(pageElRef, overlayRect);

  /** The photo backing the focused cover face's image, when it has one. */
  const coverSelectedPhoto = useMemo(() => {
    const id = cover.image.photoId;
    return id ? photoMap.get(id) : undefined;
  }, [cover.image.photoId, photoMap]);

  /** The photo in the selected frame, if the selection is a photo frame. */
  const selectedFramePhoto = useMemo(() => {
    if (!block) return undefined;
    if (selection.kind === 'base') {
      const id = selection.slot === 'right' ? block.photoIds[1] : block.photoIds[0];
      return id ? photoMap.get(id) : undefined;
    }
    if (selection.kind === 'overlay') {
      const id = block.overlays.find((o) => o.id === selection.id)?.photoId;
      return id ? photoMap.get(id) : undefined;
    }
    return undefined;
  }, [block, selection, photoMap]);

  /**
   * ENTER IMAGE-ADJUSTMENT MODE ON ONE NAMED FRAME — the single implementation behind every way
   * in.
   *
   * The Crop button on the floating toolbar and press-and-hold on the photo itself are two
   * gestures for one thing, so they must not be two code paths: they both land here, and what
   * they produce is one `crop.begin` call with the same `CropTarget` shape. There is exactly one
   * adjustment state (`useCanvasCrop`), one renderer for it (`CropBleed` + `CropLayer`) and one
   * place edits are committed (`commitPhotoEdit`), whichever door was used.
   *
   * Selecting the frame first is part of the contract, not a nicety: the toolbar renders from the
   * selection, so a long press has to leave the same thing selected the button path would have,
   * or the adjustment controls would be describing a different frame.
   */
  const beginCropOn = useCallback(
    (target: { slot?: BaseSlot; overlayId?: string; photoId: string }) => {
      if (!block) return;
      const photo = photoMap.get(target.photoId);
      // Adjustments are authored against the worker's sanitized master — the same gate every
      // other editing entry point applies, applied once more at this one.
      if (!photo || photo.status !== 'ready') return notYetEditable();
      setSelection(target.overlayId ? { kind: 'overlay', id: target.overlayId } : { kind: 'base', slot: target.slot ?? 'image' });
      crop.begin({ blockKey: block.key, slot: target.slot, overlayId: target.overlayId, photoId: target.photoId });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [block, photoMap, crop],
  );

  /** Enter image adjustment on whatever photo frame is selected — the toolbar's Crop button. */
  const startCrop = useCallback(() => {
    if (!selectedFramePhoto) return;
    if (selection.kind === 'base') beginCropOn({ slot: selection.slot, photoId: selectedFramePhoto.id });
    else if (selection.kind === 'overlay') beginCropOn({ overlayId: selection.id, photoId: selectedFramePhoto.id });
  }, [selection, selectedFramePhoto, beginCropOn]);

  /**
   * SMART SUGGESTIONS read the photos the user is about to place: their tray SELECTION when they
   * have one (the strongest available signal of intent), otherwise everything still unplaced.
   * Pure shape analysis — see `_layout-suggestions` for why there is no model behind it.
   */
  const suggestionPool = useMemo(() => {
    const chosen = selectedPhotoIds(sel.selection);
    if (chosen.length > 0) {
      const picked = chosen.map((id) => photoMap.get(id)).filter((p): p is Photo => !!p);
      if (picked.length > 0) return picked;
    }
    // Cap the sample: shape statistics converge long before 2,000 photos, and re-profiling an
    // entire import on every render would cost real time for an identical answer.
    return availablePhotos.slice(0, 60);
  }, [sel.selection, photoMap, availablePhotos]);
  const suggestions = useMemo(() => suggestLayouts(profileShapes(suggestionPool)), [suggestionPool]);
  /**
   * The shared DRAG store. `dataTransfer` still carries the payload and still drives every drop,
   * so drop behaviour is unchanged; this exists purely so destinations can DESCRIBE what is about
   * to happen (Smart Replace previews, frame highlighting, cross-page move feedback).
   */
  const drag = useDragStore();

  /**
   * MARQUEE over the tray. Hit-testing is GEOMETRIC — it converts the rubber band into index
   * ranges using the virtual grid's own `columns`/`rowStride`, so rows that virtualization has
   * not mounted are selected exactly like visible ones. A DOM-based hit test would silently skip
   * them, which is the classic virtualized-marquee bug.
   */
  const trayGridRef = useRef<HTMLDivElement | null>(null);
  const trayScrollRef = useRef<HTMLDivElement>(null);
  const marqueeGeom = useRef({ columns: 4, rowStride: 0, gap: 0, count: 0 });
  const marquee = useMarquee({
    containerRef: trayGridRef,
    scrollRef: trayScrollRef,
    hitTest: useCallback((r) => {
      const { columns, rowStride, gap, count } = marqueeGeom.current;
      if (rowStride <= 0 || columns <= 0) return [];
      const el = trayGridRef.current;
      /**
       * Column PITCH, not cell width. For a grid of `c` columns, `W = c·cell + (c−1)·gap`, so
       * `W / c` under-measures the pitch by a fraction of the gap and the error accumulates
       * across the row — enough to include a spurious extra column at the marquee's edge.
       * `(W + gap) / c` is the exact pitch.
       */
      const colPitch = el ? (el.clientWidth + gap) / columns : 0;
      if (colPitch <= 0) return [];
      const cellW = colPitch;
      const firstRow = Math.max(0, Math.floor(r.y / rowStride));
      const lastRow = Math.floor((r.y + r.h) / rowStride);
      const firstCol = Math.max(0, Math.floor(r.x / cellW));
      const lastCol = Math.min(columns - 1, Math.floor((r.x + r.w) / cellW));
      const ids: string[] = [];
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let col = firstCol; col <= lastCol; col += 1) {
          const idx = row * columns + col;
          if (idx >= 0 && idx < count) {
            const photo = visiblePhotosRef.current[idx];
            if (photo) ids.push(photo.id);
          }
        }
      }
      return ids;
    }, []),
    onSelect: useCallback(
      (ids: string[], mods: { meta: boolean; shift: boolean }) => {
        const targets = ids.map((id) => ({ kind: 'photo', photoId: id }) as SelectionTarget);
        // A plain marquee replaces; Ctrl/Cmd adds to what was already selected.
        sel.setSelection((prev) =>
          mods.meta
            ? { targets: [...prev.targets, ...targets.filter((t) => !prev.targets.some((x) => targetKey(x) === targetKey(t)))], anchor: prev.anchor }
            : { targets, anchor: targets[0] ?? null },
        );
      },
      [sel],
    ),
  });

  // Bind the late-bound remap hooks now that every store exists.
  selectionRemapRef.current = sel.remapPhotoId;
  favouritesRemapRef.current = favourites.remapId;
  labelsRemapRef.current = labels.remapId;

  // Inspector: live (local) change then persist on release — the same pair the canvas crop uses,
  // so a slider drag becomes exactly one undo step just as a crop gesture does.
  const onPhotoChange = patchPhotoLocal;
  const onPhotoCommit = commitPhotoEdit;

  /**
   * WHAT THE PROPERTIES PANEL SHOWS (Pass 3) — derived from the selection, exactly like the
   * context bar. The same inspector components that used to render inside the bar's popovers
   * render here instead, with the same callbacks — the panel is a different host, not a
   * different implementation. Null means "nothing detailed to show" (empty frame, page,
   * pending photo) and hides the panel without touching the user's open/closed preference.
   */

  const propsPanelContent = (() => {
    if (coverFocused || editLayout !== 'focus' || !block) return null;
    switch (selection.kind) {
      case 'base':
      case 'overlay': {
        const photo = selectedFramePhoto;
        // Tone edits are authored against the sanitized master — same gate as the bar's button.
        if (!photo || photo.status !== 'ready') return null;
        return {
          title: 'Photo adjustments',
          node: (
            <PhotoAdjustInspector
              edit={photo.edit ?? {}}
              onChange={(next) => onPhotoChange(photo.id, next)}
              onCommit={(next) => onPhotoCommit(photo.id, next)}
            />
          ),
        };
      }
      case 'text': {
        const el = block.texts.find((t) => t.id === selection.id);
        if (!el) return null;
        return {
          title: 'Advanced typography',
          node: (
            <TextInspector
              advanced
              el={el}
              onChange={(patch) => api.patchText(block.key, el.id, patch)}
              onDelete={() => {
                api.removeText(block.key, el.id);
                setSelection(NO_SELECTION);
              }}
            />
          ),
        };
      }
      case 'sticker': {
        const el = block.stickers.find((s) => s.id === selection.id);
        if (!el) return null;
        const i = block.stickers.findIndex((s) => s.id === el.id);
        return {
          title: 'Sticker',
          node: (
            <StickerInspector
              el={el}
              onChange={(patch) => api.patchSticker(block.key, el.id, patch)}
              onDelete={() => {
                api.removeSticker(block.key, el.id);
                setSelection(NO_SELECTION);
              }}
              onDuplicate={() => {
                const id = api.duplicateSticker(block.key, el.id);
                if (id) setSelection({ kind: 'sticker', id });
              }}
              onForward={i < block.stickers.length - 1 ? () => api.reorderSticker(block.key, el.id, 1) : undefined}
              onBackward={i > 0 ? () => api.reorderSticker(block.key, el.id, -1) : undefined}
            />
          ),
        };
      }
      case 'qr': {
        const el = block.qrs.find((q) => q.id === selection.id);
        if (!el) return null;
        return {
          title: 'QR code',
          node: (
            <QrInspector
              el={el}
              onChange={(patch) => api.patchQr(block.key, el.id, patch)}
              onDelete={() => {
                api.removeQr(block.key, el.id);
                setSelection(NO_SELECTION);
              }}
            />
          ),
        };
      }
      default:
        return null;
    }
  })();

  // Crop/edit geometry is authored against the WORKER'S sanitized master (it applies the EXIF
  // rotation, so a raw local preview can report different dimensions). Both editors therefore
  // stay closed until the photo is processed — the last line of defence behind the UI gating,
  // covering the inspector's entry point as well as the canvas.
  const notYetEditable = () =>
    setMessage({ kind: 'ok', text: 'Still processing — you can crop and adjust this photo in a moment.' });

  const openQuickCrop = (photoId: string, aspect: number, gutter: boolean) => {
    const p = photoMap.get(photoId);
    if (!p) return;
    if (p.status !== 'ready') return notYetEditable();
    setQuickCrop({ photo: p, aspect, gutter });
  };
  const openEditor = (photoId: string) => {
    const p = photoMap.get(photoId);
    if (!p) return;
    if (p.status !== 'ready') return notYetEditable();
    setEditingPhoto(p);
  };

  // ── spread actions ───────────────────────────────────────────────────────────
  const addBlock = (template: LayoutTemplate) => {
    if (!canAdd(blocks, size, template)) return;
    api.addBlock(template, size);
    setCurrent(blocks.length); // focus the new one
  };
  const insertAfter = (index: number) => {
    api.insertBlockAt(index + 1, 'single-pair', size);
    setCurrent(index + 1);
  };
  const duplicateBlock = (key: string) => {
    layoutMemory.markDuplicated(blocks.find((b) => b.key === key)?.preset);
    api.duplicateBlock(key, size);
  };
  const applyPreset = (preset: LayoutPreset) => {
    if (!block) return;
    api.applyPreset(block.key, preset, availableIds);
    // THE single place a preset is applied, so it is also the single place layout memory learns
    // from — no other call site can forget to record it.
    layoutMemory.markUsed(preset.key);
    setLayoutCycle(null); // a deliberate choice ends any cycle in progress
    setMessage({ kind: 'ok', text: 'Layout applied — review it, then Save.' });
  };

  /**
   * LAYOUT CYCLE — step this spread through its curated alternatives and back.
   *
   * The alternatives come from the administrator-configured catalog (`layoutTemplates`, the same
   * active rows the Layouts panel offers) and are ranked deterministically, so the cycle is a
   * fixed rotation rather than a shuffle — pressing the button four times on a spread with three
   * alternatives returns you to exactly what you started with.
   *
   * It owns no layout logic. Stepping FORWARD is the existing `applyPreset` command, with all of
   * its photo-preservation behaviour; stepping back to Original re-applies the snapshot taken
   * when the cycle began through the existing `patchBlock`. Both are ordinary mutations, so undo,
   * the dirty flag and Save behave exactly as they do for any other edit. Per-photo edits live on
   * the photo, not the slot, so they survive every step untouched.
   */
  /**
   * KEYBOARD NUDGE — move the selected object without touching the pointer, and without touching
   * its layer order.
   *
   * It dispatches the SAME `api.patch*` primitives the drag gesture uses, so it lands in the same
   * history entry shape, marks the album dirty the same way and saves through the same pipeline —
   * there is no second movement path. The result is clamped through `commitBounds`, exactly like a
   * released drag, so a nudge can never push an object somewhere the save would reject.
   */
  const NUDGE = 0.002;
  const NUDGE_COARSE = 0.02;

  const canNudge = !coverFocused && !!block && selection.kind !== 'none' && selection.kind !== 'base';

  /**
   * EDIT ↔ PREVIEW, WITHOUT LOSING YOUR PLACE.
   *
   * The preview is an overlay, so the builder underneath is never unmounted: zoom, scroll, the
   * open rail tab, the selection and every bit of editing state are simply still there when it
   * closes. The one thing that would otherwise be lost is WHICH SPREAD you were on, because the
   * flipbook counts physical pages while the builder counts spreads — so the two are translated
   * here, in both directions. The cover is physical page 0; spread `i` starts at `1 + i * 2`.
   */
  const previewStartPage = coverFocused ? 0 : 1 + cur * 2;

  const openPreview = useCallback(() => setFlipbookOpen(true), []);

  const closePreview = useCallback(() => {
    setFlipbookOpen(false);
    const page = previewPageRef.current;
    if (page === null) return;
    if (page <= 0) setCoverFocused(true);
    else {
      setCoverFocused(false);
      setCurrent(Math.max(0, Math.min(api.blocks.length - 1, Math.floor((page - 1) / 2))));
    }
  }, [api.blocks.length]);

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      if (!block) return;
      // One box for every kind — the nudge is clamped exactly where a released drag is.
      const shift = <T extends { x: number; y: number; w: number; h: number }>(el: T): T => ({
        ...el,
        ...clampRect({ x: el.x + dx, y: el.y + dy, w: el.w, h: el.h }, EDIT_BOUNDS),
      });
      if (selection.kind === 'overlay') {
        api.patchOverlays(
          block.key,
          block.overlays.map((o) => (o.id === selection.id ? shift(o) : o)),
        );
      } else if (selection.kind === 'text') {
        const el = block.texts.find((t) => t.id === selection.id);
        if (el) api.patchText(block.key, el.id, shift(el));
      } else if (selection.kind === 'qr') {
        const el = block.qrs.find((q) => q.id === selection.id);
        if (el) api.patchQr(block.key, el.id, shift(el));
      } else if (selection.kind === 'sticker') {
        const el = block.stickers.find((s) => s.id === selection.id);
        if (el && !el.locked) api.patchSticker(block.key, el.id, shift(el));
      }
    },
    [api, block, selection],
  );

  const cycleSteps = useMemo(
    () => (block ? layoutCycleSteps(block, layoutTemplates) : []),
    // The steps are derived from the ORIGINAL spread, so they must not be recomputed as the cycle
    // rewrites the block — hence the snapshot, not `block`, once a cycle is running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutCycle?.original ?? block, layoutTemplates],
  );
  const canCycleLayout = !!block && cycleSteps.length > 1;

  const cycleLayout = () => {
    if (!block || cycleSteps.length < 2) return;
    const original = layoutCycle?.blockKey === block.key ? layoutCycle.original : block;
    const at = layoutCycle?.blockKey === block.key ? layoutCycle.index : 0;
    const next = nextCycleIndex(at, cycleSteps);
    const step = cycleSteps[next];

    if (step.preset) {
      /**
       * No `layoutMemory.markUsed` here. Favourites and "recently used" are a record of layouts
       * the customer deliberately CHOSE from the panel; a cycle step is exploratory, and logging
       * every press would fill that list with layouts they only glanced at and rejected.
       */
      api.applyPreset(block.key, step.preset, availableIds);
    } else {
      // Back to Original — restore the geometry AND the photo placement exactly as it was.
      api.patchBlock(block.key, {
        template: original.template,
        photoIds: original.photoIds,
        overlays: original.overlays,
        preset: original.preset,
      });
    }
    setLayoutCycle({ blockKey: block.key, original, index: next });
    setMessage({ kind: 'ok', text: `${step.label} — layout ${next + 1} of ${cycleSteps.length}.` });
  };

  /**
   * FEWER / MORE PHOTOS — the other half of the consolidated Layout control.
   *
   * `layoutByDensity` picks the nearest curated layout in the requested direction using the same
   * catalog and the same capacity maths the cycle uses; applying it is the SAME `applyPreset`
   * command a panel click runs, so photo preservation, history, the dirty flag and the save
   * pipeline are all the existing ones. This adds a trigger, not a layout system.
   */
  const densityOption = useCallback(
    (dir: -1 | 1) => (block ? layoutByDensity(block, layoutTemplates, dir) : null),
    [block, layoutTemplates],
  );
  const stepLayoutDensity = (dir: -1 | 1) => {
    const preset = densityOption(dir);
    if (!preset) return;
    applyPreset(preset);
    setMessage({ kind: 'ok', text: `${preset.label} — ${dir < 0 ? 'fewer' : 'more'} photos on this spread.` });
  };
  const layoutLabel = block ? currentLayoutLabel(block, layoutTemplates) : '';
  const addText = (variant: TextVariant) => {
    if (!block) return;
    const id = api.addText(block.key, variant);
    setSelection({ kind: 'text', id });
  };
  const addQr = (data: string) => {
    if (!block) return;
    const id = api.addQr(block.key, data);
    setSelection({ kind: 'qr', id });
  };

  // "Edit Cover" (CHANGE 1) — RESUME the user's cover work rather than restarting selection.
  //   • A cover already exists (template chosen OR any custom content) → focus the cover canvas
  //     and keep the current rail (swapping the content-only 'layouts' rail for 'images'), so the
  //     user lands back where they were editing.
  //   • No cover has ever been started → open the Cover Template gallery so they can pick one.
  const coverStarted =
    !!coverId ||
    !!coverConfig.photoId ||
    !!coverConfig.background ||
    // `freeTexts`, not `texts`: every cover now carries a title object as a view of album
    // metadata, so counting all of them would call a pristine cover "started" and skip the
    // artwork gallery that a first-time customer is meant to land on.
    freeTexts(coverConfig.texts).length > 0 ||
    coverConfig.stickers.length > 0 ||
    !!coverConfig.back.photoId ||
    !!coverConfig.back.background ||
    coverConfig.back.texts.length > 0 ||
    coverConfig.back.stickers.length > 0 ||
    coverConfig.back.overlays.length > 0;
  const focusCoverForEditing = () => {
    cover.setSide('front');
    setCoverFocused(true);
    setRailTab((t) => (coverStarted ? (t === 'layouts' ? 'images' : t) : 'templates'));
  };

  // Review-card navigation (CHANGE 5) — reuse the builder's existing view state to guide the
  // customer straight to the flagged area. Physical page → its spread; cover → the cover editor;
  // "missing/empty" → the first incomplete spread.
  const goToPhysicalPage = (physicalPage: number) => {
    setCoverFocused(false);
    setEditLayout('focus');
    let acc = 0;
    for (let i = 0; i < api.blocks.length; i++) {
      acc += PAGE_COST[api.blocks[i].template];
      if (physicalPage <= acc) {
        setCurrent(i);
        return;
      }
    }
    setCurrent(Math.max(0, api.blocks.length - 1));
  };
  /**
   * ONE-CLICK NAVIGATION from a quality issue to the thing it's about (Phase 7).
   *
   * It reuses the builder's existing view state exactly as `navigateToIssue` (the submit dialog's
   * equivalent) does — focus the cover, focus a spread, or focus a spread AND select the offending
   * frame so the inspector on the right is already describing it when the user arrives. That last
   * step is the difference between "spread 7 has a problem" and being able to fix it.
   *
   * It never edits anything. Selection is a view concern; the issue itself is only ever advisory.
   */
  const goToIssue = (issue: QualityIssue) => {
    setReviewOpen(false);
    const loc = issue.location;
    if (loc.kind === 'cover') {
      setCoverFocused(true);
      cover.setSide('front');
      return;
    }
    if (loc.kind === 'tray' || loc.kind === 'photo') {
      setCoverFocused(false);
      setRailTab('images');
      if (loc.kind === 'photo') sel.pick({ kind: 'photo', photoId: loc.photoId });
      return;
    }
    const index = Math.max(0, Math.min(blocks.length - 1, loc.blockIndex));
    setCoverFocused(false);
    setEditLayout('focus');
    setCurrent(index);
    const t = loc.kind === 'frame' ? loc.target : null;
    if (t) {
      sel.pick(t);
      // Mirror it into the single-target selection too, so the right-hand Inspector opens on the
      // same frame rather than the page settings. Only frame-like targets have an Inspector view.
      const single: Selection | null =
        t.kind === 'base' ? { kind: 'base', slot: t.slot } : t.kind === 'overlay' ? { kind: 'overlay', id: t.id } : null;
      if (!single) return;
      if (index === cur) setSelection(single);
      else pendingFrameSel.current = single; // survives the focus-change reset — see above
    }
  };

  const goToFirstIncomplete = () => {
    setCoverFocused(false);
    setEditLayout('focus');
    const idx = api.blocks.findIndex((b) => !isBlockComplete(b));
    setCurrent(idx >= 0 ? idx : 0);
    setRailTab('images'); // surface the photo tray so they can fill the gap
  };

  // The FRONT cover image actually shown (preview + flipbook + print): chosen photo → template → none.
  const coverImageUrl = useMemo(() => {
    if (coverConfig.photoId) return resolvePhotoUrl(photoMap.get(coverConfig.photoId), 'full');
    if (coverConfig.background) return null;
    return selectedCover?.url ?? null;
  }, [coverConfig.photoId, coverConfig.background, photoMap, selectedCover]);
  // The BACK cover image (its own uploaded photo; no admin artwork on the back).
  const backCoverImageUrl = useMemo(
    () => (coverConfig.back.photoId ? resolvePhotoUrl(photoMap.get(coverConfig.back.photoId), 'full') : null),
    [coverConfig.back.photoId, photoMap],
  );

  /**
   * The cover, in the shape every read-only preview surface takes. One object, so the layout
   * proposal, the flipbook and the post-purchase view cannot disagree about which cover they are
   * showing — and none of them can fall back to the bare template artwork the way `_preview` did.
   */
  const previewCover = useMemo(
    () => ({
      config: coverConfig,
      title: albumTitle,
      size,
      frontImageUrl: coverImageUrl,
      backImageUrl: backCoverImageUrl,
    }),
    [coverConfig, albumTitle, size, coverImageUrl, backCoverImageUrl],
  );

  /**
   * ADD AN EMPTY PHOTO FRAME to the focused spread, and select it.
   *
   * THE single implementation behind every "add overlay" affordance — the page toolbar's Photo
   * button and the per-spread button on the canvas — so both create the same object in the same
   * place through the same `api.addOverlay`. It creates a container and nothing else: no picker,
   * no photo record, no image request. The customer fills it afterwards, which is the same order
   * a new page's starting frame is filled in.
   */
  const addPageOverlay = () => {
    if (!block) return;
    const newId = api.addOverlay(block.key, null, 'center');
    if (newId) setSelection({ kind: 'overlay', id: newId });
  };

  // ── page sticker add (from the Stickers rail) ──────────────────────────────────
  const addPageSticker = (stickerId: string) => {
    if (!block) return;
    const id = api.addSticker(block.key, stickerId);
    setSelection({ kind: 'sticker', id });
  };

  // ── focus navigation (cover ↔ spreads) — one linear sequence [cover, spread 0, …] ──
  const focusCover = () => {
    setCoverFocused(true);
    setSelection(NO_SELECTION);
    setRailTab((t) => (t === 'layouts' ? 'images' : t)); // layouts is content-page only; QR now works on the cover
  };
  const focusBlock = (i: number) => {
    setCoverFocused(false);
    cover.setSelection(NO_SELECTION);
    setRailTab((t) => (t === 'templates' ? 'images' : t)); // templates is cover-only
    setCurrent(i);
  };
  const goPrev = () => {
    if (coverFocused) return;
    if (cur <= 0) focusCover();
    else setCurrent((c) => Math.max(0, c - 1));
  };
  const goNext = () => {
    if (coverFocused) {
      if (blocks.length > 0) focusBlock(0);
      return;
    }
    setCurrent((c) => Math.min(blocks.length - 1, c + 1));
  };

  /**
   * ── THE PROPERTIES PANEL, AFTER THE COVER SIDEBAR ──────────────────────────────
   *
   * There is no cover branch here any more, and that absence is the deliverable. The cover used
   * to force this panel open on focus (`useEffect(() => setPropsPanelOpen(true))`) and fill it
   * with `CoverPanel` — a permanent 300px column of sliders that no other surface had, and the
   * last place the builder behaved like two applications. Both are deleted.
   *
   * The cover's detailed controls now live exactly where a page's do: on the floating toolbar for
   * everyday actions, and in THIS panel — opened deliberately, never automatically — for the
   * advanced ones. `propsPanelContent` already routes by `selection.kind`, and the cover speaks
   * the same `Selection`, so it needed no cover-shaped copy.
   */
  const coverPropsPanelContent = (() => {
    if (!coverFocused) return null;
    const key = `cover:${cover.side}`;
    // Narrowed once into a local: TypeScript cannot follow `cover.selection.kind` through a
    // property access, and the alternative is a cast per branch.
    const csel = cover.selection;
    switch (csel.kind) {
      case 'text': {
        const el = cover.elements.texts.find((t) => t.id === csel.id);
        if (!el) return null;
        return {
          title: 'Advanced typography',
          node: (
            <TextInspector
              advanced
              el={el}
              onChange={(patch) => cover.patchText(key, el.id, patch)}
              // The title and the spine are the album's metadata made visible — they always
              // print, so the inspector offers no Delete for them (`useCover` refuses it too).
              onDelete={
                isPermanentRole(el.role)
                  ? undefined
                  : () => {
                      cover.removeText(key, el.id);
                      cover.setSelection(NO_SELECTION);
                    }
              }
            />
          ),
        };
      }
      case 'sticker': {
        const el = cover.elements.stickers.find((s) => s.id === csel.id);
        if (!el) return null;
        return {
          title: 'Sticker',
          node: (
            <StickerInspector
              el={el}
              onChange={(patch) => cover.patchSticker(key, el.id, patch)}
              onDelete={() => {
                cover.removeSticker(key, el.id);
                cover.setSelection(NO_SELECTION);
              }}
              onDuplicate={() => cover.duplicateSticker(key, el.id)}
              onForward={() => cover.moveLayer({ kind: 'sticker', blockKey: key, id: el.id }, 'forward')}
              onBackward={() => cover.moveLayer({ kind: 'sticker', blockKey: key, id: el.id }, 'backward')}
            />
          ),
        };
      }
      case 'qr': {
        const el = cover.elements.qrs.find((q) => q.id === csel.id);
        if (!el) return null;
        return {
          title: 'QR code',
          node: (
            <QrInspector
              el={el}
              onChange={(patch) => cover.patchQr(key, el.id, patch)}
              onDelete={() => {
                cover.removeQr(key, el.id);
                cover.setSelection(NO_SELECTION);
              }}
            />
          ),
        };
      }
      case 'base': {
        const photo = coverConfig.photoId && cover.side === 'front' ? photoMap.get(coverConfig.photoId) : coverConfig.back.photoId && cover.side === 'back' ? photoMap.get(coverConfig.back.photoId) : undefined;
        if (!photo || photo.status !== 'ready') return null;
        return {
          title: 'Photo adjustments',
          node: (
            <PhotoAdjustInspector
              edit={cover.image.edit ?? {}}
              // A cover crop is independent of how the same photo is cropped on a page, so this
              // writes `cover_config.imageEdit` — not the photo row. Same inspector, one seam.
              onChange={(next) => cover.patchImageEdit(next)}
              onCommit={(next) => cover.patchImageEdit(next)}
            />
          ),
        };
      }
      default:
        return null;
    }
  })();

  const panelContent = coverFocused ? coverPropsPanelContent : propsPanelContent;

  // ── Auto Align (toolbar) — tidies the focused cover face / spread (text + stickers).
  const canAutoAlign = coverFocused
    ? cover.elements.texts.length + cover.elements.stickers.length > 0
    : !!block && block.texts.length + block.stickers.length > 0;
  const autoAlignCurrent = () => {
    if (coverFocused) {
      const { texts, stickers } = cover.elements;
      if (texts.length + stickers.length === 0) return;
      const next = autoAlignCover(texts, stickers);
      cover.writeSide(cover.side, { texts: next.texts, stickers: next.stickers });
    } else {
      if (!block) return;
      const next = autoAlignBlock(block);
      api.patchBlock(block.key, { texts: next.texts, stickers: next.stickers });
    }
    setMessage({ kind: 'ok', text: coverFocused ? `Aligned the ${COVER_SIDE_LABEL[cover.side].toLowerCase()}.` : 'Aligned the page.' });
  };

  // ── auto-layout ────────────────────────────────────────────────────────────────
  // Phase 4: the engine now accepts photos measured in the BROWSER as well as by the worker.
  // Both sources are ORIENTED (the worker bakes EXIF in; extraction decodes with
  // `imageOrientation: 'from-image'`), so `classify` reads them the same way — which is what
  // makes it safe to lay out immediately and verify afterwards. A photo with no reliable size
  // from either source (HEIC, or a decode we didn't trust) is simply skipped, exactly as before.
  const engineInputs = useMemo(() => layoutInputs(photos), [photos]);
  const enginePhotos: EnginePhoto[] = engineInputs;
  const availableEngine = useMemo(() => layoutInputs(availablePhotos), [availablePhotos]);
  const templateChoices = useMemo(() => layoutTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays })), [layoutTemplates]);

  const generate = (kind: LayoutKind, strategy = 0) => {
    let proposed: Block[];
    let title2: string;
    switch (kind) {
      case 'build':
        proposed = autoLayout(enginePhotos, size, strategy, templateChoices);
        title2 = 'Build my album';
        break;
      case 'suggest':
        proposed = regenerate(enginePhotos, size, strategy, templateChoices);
        title2 = 'Suggested structure';
        break;
      case 'fill':
        proposed = fillEmptyFrames(blocks, availableEngine);
        title2 = 'Fill empty frames';
        break;
    }
    setProposal({ kind, strategy, blocks: proposed, title: title2, summary: summarizePlan(proposed, enginePhotos.length) });
    setBuildMethodOpen(false);
  };

  // ── Blueprint apply (reuses the wizard's workflow inside the builder) ────────────
  // The default blueprint Full Auto uses (admin's default for this size, else closest capacity).
  const defaultBlueprint: BuilderBlueprint | null = blueprints.length
    ? blueprints.find((b) => b.isDefault) ??
      blueprints.reduce((best, b) => (Math.abs(b.slotCount - enginePhotos.length) < Math.abs(best.slotCount - enginePhotos.length) ? b : best), blueprints[0])
    : null;

  // Apply a blueprint to the CURRENT album (client-side, reusing pure applyBlueprint), then the user
  // reviews + Saves — identical persistence to the existing "apply proposal" path.
  const applyBlueprintInBuilder = (bp: BuilderBlueprint, autoPlace: boolean) => {
    const ids = autoPlace ? enginePhotos.map((p) => p.id) : []; // enginePhotos are date-ordered (page load)
    api.replaceAll(applyBlueprint(bp.blueprint, ids));
    setCurrent(0);
    setBuildMethodOpen(false);
    setBpPickerOpen(false);
    setMessage({ kind: 'ok', text: `Applied “${bp.name}” — review it, then Save.` });
  };

  // Full Auto → the default blueprint (or, with no blueprints for this size, the deterministic auto-layout).
  const runFullAuto = () => {
    if (defaultBlueprint) applyBlueprintInBuilder(defaultBlueprint, true);
    else generate('build', 0);
  };
  const acceptProposal = () => {
    if (!proposal) return;
    api.replaceAll(proposal.blocks);
    // Remember what shapes this layout assumed, so the guesses can be verified once the worker
    // reports the real ones (see `_use-optimistic-layout`).
    optimisticLayout.record(proposal.blocks, engineInputs);
    setProposal(null);
    setCurrent(0);
    setMessage({ kind: 'ok', text: 'Layout applied — review it, then Save.' });
  };

  /**
   * Rebuild the layout from the now-authoritative shapes. Used both by the silent auto-fix and
   * by the user accepting the drift offer.
   */
  const rebuildFromVerified = useCallback(() => {
    const inputs = layoutInputs(photosRef.current);
    const rebuilt = autoLayout(inputs, size, 0, templateChoices);
    api.replaceAll(rebuilt);
    optimisticLayout.record(rebuilt, inputs);
  }, [api, size, templateChoices, optimisticLayout]);

  /**
   * VERIFY the optimistic layout as the worker's real dimensions land.
   *
   * Matching shapes → nothing happens at all. A mismatch on an untouched layout → rebuilt
   * silently. A mismatch after the user has edited → their work is left alone and a quiet offer
   * appears instead (rendered near the canvas), because reconciliation must never overwrite
   * something a person deliberately arranged.
   */
  useEffect(() => {
    if (!optimisticLayout.isOptimistic) return;
    const { drifted, canAutoFix } = optimisticLayout.verify(photos, blocksRef.current);
    if (drifted.length > 0 && canAutoFix) rebuildFromVerified();
  }, [photos, optimisticLayout, rebuildFromVerified]);

  // ── persistence ───────────────────────────────────────────────────────────────
  // Serialization (including the temp-id resolve/strip boundary), the save sequence and the
  // saved/dirty bookkeeping now live in the save controller. This component only triggers it.
  const { save, saving, lastSaved, setLastSaved, serializeForSave, strippedNote } = useSaveController({
    albumId,
    api,
    idMap,
    flushCoverDebounce: () => {
      if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
    },
    getCover: () => ({ title: albumTitle, coverId, config: coverConfig }),
    onMessage: setMessage,
  });

  // Save & exit (header) — never leave silently: with unsaved changes, open the guard dialog
  // (CHANGE 4). Clean albums leave immediately.
  const saveAndExit = () => {
    if (api.dirty) {
      setMessage(null); // dialog error area starts clean
      setExitConfirmOpen(true);
      return;
    }
    router.push('/dashboard');
  };

  // Guard-dialog actions. Save & Leave runs the full reliable save and ONLY navigates on success
  // (CHANGE 5 — a failed save prevents exit and shows the error); Leave discards.
  const confirmSaveAndLeave = async () => {
    setExiting(true);
    const ok = await save();
    if (!ok) {
      setExiting(false);
      return; // keep the dialog open; the error message is shown
    }
    setExitConfirmOpen(false);
    router.push('/dashboard');
  };
  const confirmLeaveWithout = () => {
    api.setDirty(false); // suppress the beforeunload/popstate guard for this intentional exit
    setExitConfirmOpen(false);
    router.push('/dashboard');
  };

  // ── Blueprint Mode (admin) ──────────────────────────────────────────────────────
  // The admin-only save/exit branch lives in its own controller — it shares nothing with the
  // customer flow except the serialization boundary and the "last saved" clock.
  const blueprint = useBlueprintMode({
    albumId,
    api,
    serializeBlocks: serializeForSave,
    onMessage: setMessage,
    onSaved: () => setLastSaved(Date.now()),
  });
  const saveBlueprint = blueprint.save;
  const blueprintSaving = blueprint.saving;
  const doExitBlueprint = blueprint.doExit;
  const requestExitBlueprint = blueprint.requestExit;
  const exitDialogOpen = blueprint.exitDialogOpen;
  const setExitDialogOpen = blueprint.setExitDialogOpen;

  // Phase 1 — user clicks Submit: flush pending saves, then run the CENTRAL validation service on
  // the current state. If ANY issue (error or warning) → show the informational dialog. If clean →
  // submit directly. Validation never blocks; it informs (the dialog offers "Continue Anyway").
  const onSubmitClick = async () => {
    // Phase 3 guard. Validation reads the CLIENT's blocks, where a still-uploading photo looks
    // like a filled slot — but the save strips it, so the album would be submitted with a hole
    // the user was told was filled. A few seconds of waiting is far better than a silently
    // incomplete submission, so stop here and say exactly why.
    const stillUploading = photos.filter((p) => isTempPhotoId(p.id) && placed.has(p.id)).length;
    if (stillUploading > 0) {
      setMessage({
        kind: 'err',
        text: `${stillUploading} photo${stillUploading === 1 ? '' : 's'} you've placed ${stillUploading === 1 ? 'is' : 'are'} still uploading. Give ${stillUploading === 1 ? 'it' : 'them'} a moment, then submit — otherwise ${stillUploading === 1 ? 'that page' : 'those pages'} would be sent empty.`,
      });
      return;
    }
    setChecking(true);
    setMessage(null);
    // Flush the debounced cover design + layout so validation reads the CURRENT state, not a stale row.
    if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
    // Unconditional: the flush exists so validation reads the CURRENT cover, and a blank title
    // must not leave it reading a stale row. The server ignores a blank title and saves the rest.
    await saveCoverDesign({ albumId, title: albumTitle, coverTemplateId: coverId, config: coverConfig });
    const { blocks: payload, stripped } = serializeForSave();
    const saved = await saveLayout({ albumId, blocks: payload });
    setChecking(false);
    if (!saved.ok) {
      setMessage({ kind: 'err', text: saved.error });
      return;
    }
    api.setDirty(stripped > 0);
    if (stripped > 0) setMessage({ kind: 'ok', text: `Saved.${strippedNote(stripped)}` });
    // Same central service the server + PDF use; `activeTemplate` = a selected active cover id.
    const report = evaluateAlbum({
      size,
      blocks,
      cover: { activeTemplate: !!coverId, config: coverConfig, title: albumTitle },
    });
    if (report.issues.length > 0) {
      setValidation(report); // show the grouped review dialog — user decides
      return;
    }
    await doSubmit();
  };

  // Jump straight to the place an issue points at (one-click fix navigation).
  const navigateToIssue = (action: IssueAction) => {
    setValidation(null);
    if (!action) return;
    if (action.type === 'goto-front-cover') {
      setCoverFocused(true);
      cover.setSide('front');
    } else if (action.type === 'goto-back-cover') {
      setCoverFocused(true);
      cover.setSide('back');
    } else {
      // goto-page / goto-layout / goto-photo — focus that content spread.
      setCoverFocused(false);
      setEditLayout('focus');
      setCurrent(Math.max(0, Math.min(blocks.length - 1, action.page - 1)));
    }
  };

  // Dialog "Submit"/"Submit Anyway": print-ready → submit; otherwise confirm first (CHANGE 7).
  const onDialogContinue = () => {
    if (validation?.printReady) void doSubmit();
    else setConfirmOpen(true);
  };

  // Phase 2 — actual submission (direct when clean, via the dialog, or after confirmation).
  const doSubmit = async () => {
    setValidation(null);
    setConfirmOpen(false);
    setSubmitting(true);
    const wasChanges = review?.status === 'changes_requested';
    const res = await submitAlbum(albumId);
    setSubmitting(false);
    if (res.ok) {
      setStatus('submitted');
      setReview({ status: 'pending_review', requestedChanges: null });
      if (wasChanges) {
        // CHANGE 3: review returns to Pending Review and the (paid) album is locked again. Rather
        // than fall back to a Checkout button, show a clear confirmation. setDirty(false) so the
        // exit guards don't fire on the way out.
        api.setDirty(false);
        setResubmitted(true);
      } else {
        setMessage({
          kind: 'ok',
          text: 'Album submitted for review! You can still edit it until you place an order.',
        });
      }
    } else {
      setMessage({ kind: 'err', text: res.error });
    }
  };

  // ── zoom ────────────────────────────────────────────────────────────────────────
  /**
   * THE WORKSPACE, MEASURED — and the width the spread is drawn at so it fits inside it.
   *
   * The canvas used to size the spread as a percentage of its own WIDTH, which says nothing about
   * the height available, so on most screens a spread was taller than the workspace and the
   * canvas scrolled. Measuring the box and solving for a width that fits BOTH axes is what makes
   * "100%" mean "the whole spread" rather than "as wide as the panel".
   *
   * It changes only how large the album is DRAWN. Page dimensions, overlay coordinates, text
   * sizes, the print CSS and the PDF are untouched — see `_use-fit-scale`.
   */
  const canvas = useMeasuredBox<HTMLDivElement>();
  /** The per-spread action row above the page, plus its margin — vertical furniture to budget for. */
  const SPREAD_CHROME_PX = 44;
  /**
   * The upper bound on how large the spread may be drawn. Raised from 1400 so the bleed ring and
   * the dotted trim reference are comfortably legible on a wide display — the page rectangle now
   * represents the 206 × 291 mm ARTWORK, and the 3 mm that gets trimmed is 1.46 % of it, so the
   * guide's readability scales directly with this.
   *
   * It is a CEILING, not a target: `fitBlockWidth` still takes the minimum of the workspace width,
   * the height that keeps the whole spread visible, and this. On a height-constrained laptop the
   * spread is already as large as it can be without scrolling, so nothing changes there — which is
   * the point of the fit logic and the reason this is the only lever touched.
   */
  const SPREAD_MAX_PX = 1700;
  const fitWidth = useMemo(
    () => fitBlockWidth(canvas.box, { aspect: pairA, padFrac: PASTEBOARD_PCT / 100, chromePx: SPREAD_CHROME_PX, maxPx: SPREAD_MAX_PX }),
    [canvas.box, pairA],
  );

  const zoomIn = () => setZoomPct((z) => Math.min(200, z + 15));
  const zoomOut = () => setZoomPct((z) => Math.max(50, z - 15));
  const resetZoom = () => setZoomPct(100);

  /**
   * ── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────────
   * ONE declarative table, dispatched by the shortcut manager. Every entry that edits invokes a
   * COMMAND, so the keyboard, the context menu and the buttons cannot drift apart. Modifiers are
   * platform-resolved (`mod` = ⌘ on Apple, Ctrl elsewhere) and bindings are inert while typing
   * unless they explicitly opt in.
   */
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      // Undo follows the focused surface — the cover is history-backed now, not an exception.
      { combo: "mod+z", label: "Undo", group: "Editing", allowInInput: false, run: () => (coverFocused ? cover.undo() : undoEdits()) },
      { combo: "mod+shift+z", label: "Redo", group: "Editing", run: () => (coverFocused ? cover.redo() : redoEdits()) },
      {
        combo: "mod+s",
        label: "Save",
        group: "Editing",
        allowInInput: true,
        run: () => {
          if (api.dirty) void (blueprintMode ? saveBlueprint() : save());
        },
      },
      { combo: "mod+a", label: "Select all", group: "Selection", run: () => cmd.commands.selectAll.run() },
      /**
       * DELETE / BACKSPACE now run the priority-resolved `deleteSelection` rather than the frame
       * -only `removeFromPage`. Selecting an overlay and pressing Delete removes THAT OVERLAY;
       * it can no longer leave an empty container behind, and it can never reach the page.
       * The ladder lives in the command layer — see `deleteSelection`.
       */
      {
        combo: "Delete",
        label: "Delete selection",
        group: "Editing",
        when: () => cmd.commands.deleteSelection.enabled,
        run: () => cmd.commands.deleteSelection.run(),
      },
      {
        combo: "Backspace",
        label: "Delete selection",
        group: "Editing",
        when: () => cmd.commands.deleteSelection.enabled,
        run: () => cmd.commands.deleteSelection.run(),
      },
      {
        combo: "mod+d",
        label: "Duplicate page",
        group: "Editing",
        when: () => cmd.commands.duplicatePage.enabled,
        run: () => cmd.commands.duplicatePage.run(),
      },
      { combo: "r", label: "Rotate 90°", group: "Editing", when: () => cmd.commands.rotatePhotos.enabled, run: () => cmd.commands.rotatePhotos.run() },
      /**
       * TRIAGE KEYS. 1–4 mark the selected photos, following the convention every photo editor
       * has used for twenty years — the number IS the mark, and 0 clears it. Each one runs the
       * corresponding COMMAND, so the key, the context menu and the selection bar can't drift.
       */
      ...PHOTO_LABELS.map((key, i) => ({
        combo: String(i + 1),
        label: `Mark “${LABEL_META[key].label}”`,
        group: "Editing" as const,
        when: () => cmd.commands[`label:${key}`].enabled,
        run: () => cmd.commands[`label:${key}`].run(),
      })),
      {
        combo: "0",
        label: "Remove mark",
        group: "Editing",
        when: () => cmd.commands['label:clear'].enabled,
        run: () => cmd.commands['label:clear'].run(),
      },
      {
        combo: "f",
        label: "Star / unstar",
        group: "Editing",
        when: () => cmd.commands.toggleFavourite.enabled,
        run: () => cmd.commands.toggleFavourite.run(),
      },
      {
        combo: "q",
        label: "Album quality",
        group: "View",
        run: () => setRailTab((t) => (t === 'quality' ? 'images' : 'quality')),
      },
      {
        combo: "v",
        label: "Review mode",
        group: "View",
        when: () => blocks.length > 0,
        run: () => setReviewOpen(true),
      },
      { combo: "mod+=", label: "Zoom in", group: "View", run: zoomIn },
      { combo: "mod++", label: "Zoom in", group: "View", run: zoomIn },
      { combo: "mod+-", label: "Zoom out", group: "View", run: zoomOut },
      { combo: "mod+0", label: "Fit page", group: "View", run: resetZoom },
      { combo: "g", label: "Toggle guides", group: "View", run: () => setShowGuides((v) => !v) },
      { combo: "?", label: "Shortcuts", group: "View", run: () => setShortcutsOpen((v) => !v) },
      {
        combo: "Escape",
        label: "Dismiss / deselect",
        group: "Selection",
        allowInInput: true,
        run: () => {
          contextMenu.close();
          setShortcutsOpen(false);
          setFlipbookOpen(false);
          setEditingPhoto(null);
          setQuickCrop(null);
          setPickedId(null);
          setExitDialogOpen(false);
          sel.clear();
          setSelection(NO_SELECTION);
        },
      },
      /**
       * ARROWS DO THE OBVIOUS THING FOR WHAT IS SELECTED.
       *
       * With an object selected they nudge it; with nothing selected they turn the page. One
       * binding per key, branching inside `run`, because the shortcut table is keyed by combo and
       * two rows for `ArrowLeft` would mean one silently shadowing the other.
       *
       * Nudging is also what makes a COVERED object fully editable. Its handles are reachable
       * (they are drawn above the stack) but its body may be entirely hidden, so there is nowhere
       * to grab for a drag — the keyboard is the way, and it is the accessible way regardless.
       */
      ...(
        [
          ['ArrowLeft', -1, 0],
          ['ArrowRight', 1, 0],
          ['ArrowUp', 0, -1],
          ['ArrowDown', 0, 1],
        ] as const
      ).flatMap(([key, sx, sy]) => [
        {
          combo: key,
          label: key === 'ArrowLeft' || key === 'ArrowRight' ? 'Nudge selection / change spread' : 'Nudge selection',
          group: 'Navigation' as const,
          when: () => canNudge || (editLayout === 'focus' && (key === 'ArrowLeft' || key === 'ArrowRight')),
          run: () => {
            if (canNudge) return nudgeSelection(sx * NUDGE, sy * NUDGE);
            if (key === 'ArrowLeft') setCurrent((c) => Math.max(0, c - 1));
            else if (key === 'ArrowRight') setCurrent((c) => Math.min(blocks.length - 1, c + 1));
          },
        },
        {
          combo: `shift+${key}`,
          label: 'Nudge selection further',
          group: 'Editing' as const,
          when: () => canNudge,
          run: () => nudgeSelection(sx * NUDGE_COARSE, sy * NUDGE_COARSE),
        },
      ]),
    ],
    [api, save, saveBlueprint, blueprintMode, cmd, editLayout, blocks.length, setExitDialogOpen, sel, contextMenu, canNudge, nudgeSelection, cover, coverFocused, undoEdits, redoEdits],
  );
  /**
   * Review mode owns the keyboard while it is open (it binds its own capture-phase listener), so
   * the builder's table stands down entirely rather than competing. ⌘Z on a review screen would
   * be baffling; nothing on that surface edits.
   */
  useShortcuts(shortcuts, !reviewOpen);

  // The grid overview uses the SAME resolver as the preview/flipbook/navigator. It previously
  // omitted `state`/`since` — the copy that had fallen behind — so overview frames now carry the
  // same processing badge as every other surface.
  const photoForOverview = usePhotoFor(photoMap, photoStateFor);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[hsl(150_12%_97%)] max-md:pb-[calc(3.25rem+env(safe-area-inset-bottom))]">
      {blueprintMode ? (
        <BlueprintHeader
          meta={blueprintMeta}
          size={size}
          capacity={totalSlots}
          recommended={totalSlots}
          lastSaved={lastSaved}
          dirty={api.dirty}
        />
      ) : (
        <BuilderHeader email={email} saving={saving} exiting={exiting} onSaveExit={saveAndExit} />
      )}
      <CanvasToolbar
        title={albumTitle}
        status={status}
        review={review}
        dirty={api.dirty}
        // Undo follows the FOCUSED SURFACE. The cover has real history now (`useCover` uses the
        // same `useHistoryState` container `useBlocks` does), so ⌘Z means the same thing on it as
        // it does on a spread — it used to mean nothing at all.
        canUndo={coverFocused ? cover.canUndo : history.canUndo}
        canRedo={coverFocused ? cover.canRedo : history.canRedo}
        onUndo={coverFocused ? cover.undo : history.undo}
        onRedo={coverFocused ? cover.redo : history.redo}
        showGuides={showGuides}
        onToggleGuides={() => setShowGuides((v) => !v)}
        onShortcuts={() => setShortcutsOpen(true)}
        zoomPct={zoomPct}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFitWidth={resetZoom}
        onActualSize={resetZoom}
        onAutoAlign={autoAlignCurrent}
        canAutoAlign={canAutoAlign}
        onBuildForMe={() => setBuildMethodOpen(true)}
        onPreview={openPreview}
        onExitPreview={closePreview}
        previewMode={flipbookOpen}
        onSave={save}
        saving={saving}
        onSubmit={onSubmitClick}
        submitting={submitting}
        albumId={albumId}
        onOpenSettings={blueprintMode ? undefined : () => setSettingsOpen(true)}
        reviewMode={reviewMode}
        revisionNumber={review?.revisionNumber ?? 1}
        blueprintMode={blueprintMode}
        onSaveBlueprint={saveBlueprint}
        onExitBlueprint={requestExitBlueprint}
        blueprintSaving={blueprintSaving}
      />

      {/* Review Revision Mode summary card (CHANGE 1/4/5/6/10) — replaces the plain banner with a
          reassuring, actionable review card. Same builder engine below it. */}
      {reviewMode && review && (
        <ReviewRevisionCard
          albumId={albumId}
          requestedChanges={review.requestedChanges}
          requestedAt={review.requestedAt ?? null}
          revisionNumber={review.revisionNumber ?? 1}
          onGoToPage={goToPhysicalPage}
          onGoToCover={focusCoverForEditing}
          onGoToIncomplete={goToFirstIncomplete}
          validation={evaluateAlbum({ size, blocks, cover: { activeTemplate: !!coverId, config: coverConfig, title: albumTitle } })}
          renderReadiness={initialRenderReadiness}
          onIssueNav={navigateToIssue}
        />
      )}

      {/* 3 columns — one continuous editor (the cover is page 0) */}
      <div className="flex min-h-0 flex-1">
        {/*
          LEFT — rail + sidebar.

          ≥lg: unchanged — a 68px icon rail beside a 284px panel, exactly as before.
          md–lg: same shape, narrower panel, so a tablet still gets a real canvas beside it.
          <md: the pair leaves the flow entirely and becomes bottom chrome — the rail is a
          horizontal tab bar pinned to the bottom edge and the panel is a sheet above it. At
          375px the fixed 68+284 left column left 23px for the canvas, i.e. the one thing the
          builder is for was off screen. Canvas-first is the only workable phone layout.
        */}
        <div
          className={`flex flex-none border-border/70 bg-card max-md:pointer-events-none max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex-col-reverse max-md:border-r-0 md:border-r ${
            sheetOpen ? 'max-md:top-0' : ''
          }`}
        >
          <nav
            className="pointer-events-auto order-2 flex w-[68px] flex-col items-center gap-1 border-border/70 py-3 max-md:order-none max-md:w-full max-md:flex-row max-md:justify-between max-md:gap-0 max-md:border-t max-md:bg-card max-md:px-1 max-md:py-1 max-md:pb-[max(0.25rem,env(safe-area-inset-bottom))] md:order-none md:border-r"
            aria-label="Tools"
          >
            {RAIL.filter((t) => (coverFocused ? t.key !== 'layouts' : t.key !== 'templates')).map((t) => {
              const active = railTab === t.key;
              // The Quality tab carries a count of what needs attention — the ONLY badge on the
              // rail, and absent entirely when the album is clean, so it means something.
              const flagged = t.key === 'quality' ? quality.attention.length : 0;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    // Desktop: unchanged — just switch the panel.
                    // Phone: the rail is a tab bar, so tapping the active tool closes the sheet
                    // and hands the whole screen back to the canvas.
                    if (railTab === t.key) setSheetOpen((o) => !o);
                    else setSheetOpen(true);
                    setRailTab(t.key);
                  }}
                  aria-current={active ? 'page' : undefined}
                  aria-label={flagged > 0 ? `${t.label} — ${flagged} needing attention` : undefined}
                  // Phone: each tool becomes an equal-width tab with a ≥44px touch height.
                  className={`relative flex w-[56px] flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright max-md:w-auto max-md:min-h-[44px] max-md:flex-1 max-md:gap-0.5 max-md:rounded-lg max-md:px-0.5 max-md:py-1.5 max-md:text-[9px] ${
                    active ? 'bg-studio text-studio-foreground shadow-soft' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <t.Icon className="h-[18px] w-[18px]" />
                  {t.label}
                  {flagged > 0 && (
                    <span
                      aria-hidden
                      className={`absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold tabular-nums ${
                        active ? 'bg-studio-foreground text-studio' : 'bg-warning text-warning-foreground'
                      }`}
                    >
                      {flagged}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/*
            The panel. On phone it is a bottom sheet: hidden until a tool is tapped, capped at
            most of the viewport, and scrollable inside itself so the canvas and the tab bar are
            never pushed off screen.
          */}
          <aside
            className={`pointer-events-auto flex w-[284px] flex-col overflow-hidden max-md:w-full max-md:rounded-t-2xl max-md:border-t max-md:border-border/70 max-md:shadow-[0_-8px_28px_-12px_hsl(var(--foreground)/0.18)] md:w-[240px] lg:w-[284px] ${
              sheetOpen ? 'max-md:max-h-[calc(100dvh-8.5rem)] max-md:flex-1' : 'max-md:hidden'
            }`}
          >
            {/* Sheet handle — phone only; the panel has no dismiss affordance on desktop. */}
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="hidden shrink-0 items-center justify-center gap-2 border-b border-border/60 py-2 text-[11px] font-medium text-muted-foreground max-md:flex"
              aria-label="Close panel"
            >
              <span aria-hidden className="h-1 w-9 rounded-full bg-border" />
            </button>
            {railTab === 'images' && (
              <>
                {/*
                  THE HEADER, COMPRESSED. This block used to run ~380px before a single thumbnail
                  appeared: a 180px dropzone, a four-dot pipeline stepper, four large stat cards
                  and a bordered quality card. On a laptop that left roughly two rows of photos
                  visible in a panel whose entire purpose is browsing and dragging photos.
                  Everything here is now horizontal and hairline-separated — same information,
                  same controls, same click targets, about a third of the height. Every pixel
                  saved goes to the grid below, which is the actual objective.
                */}
                <div className="space-y-2 border-b border-border/70 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[12.5px] font-semibold tracking-tight text-foreground">Photos</h2>
                    <span
                      className={`ml-auto rounded-full px-1.5 py-px text-[10.5px] font-semibold tabular-nums ${
                        photos.length >= photoCap(size) ? 'bg-warning/15 text-warning ring-1 ring-warning/25' : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      {photos.length} / {photoCap(size)}
                    </span>
                  </div>

                  <Uploader albumId={albumId} remaining={photoCap(size) - photos.length} uploads={uploads} />

                  {/* One line for the whole batch — renders nothing when nothing is in flight. */}
                  <SessionStatus
                    stats={uploads.stats}
                    activeSessions={uploads.activeSessions}
                    processing={pendingPhotos}
                    failedUploads={uploads.stats.retryable}
                    rejectedPhotos={rejectedPhotos}
                  />

                  {/*
                    Stats + quality share ONE bordered container split by hairlines, rather than
                    five separate cards each paying for its own border, radius and padding. The
                    numbers are unchanged and all four labels stay — they just read as a spec
                    sheet (label left, value right) instead of four tiles.
                  */}
                  <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                    <div className="grid grid-cols-2 gap-x-px gap-y-px bg-border/50">
                      <PhotoStat label="Capacity" value={totalSlots} />
                      <PhotoStat label="Placed" value={placedCount} />
                      <PhotoStat label="Empty" value={emptyBaseSlots} tone={emptyBaseSlots > 0 ? 'warning' : 'ok'} />
                      <PhotoStat label="Unused" value={readyUnplaced.length} tone={readyUnplaced.length > 0 ? 'muted' : 'ok'} />
                    </div>
                    {/* Quality — a status ROW attached to the stats, not a card of its own. Same
                        click behaviour, same destination, ~20px instead of ~46px. */}
                    <button
                      type="button"
                      onClick={() => setRailTab('quality')}
                      className="flex w-full items-center gap-1.5 border-t border-border/70 px-2 py-1.5 text-left transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-studio-bright"
                    >
                      {quality.clean ? (
                        <CheckCircle2 className="h-3 w-3 flex-none text-studio" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 flex-none text-warning" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                        {quality.clean
                          ? 'Quality looks good'
                          : `${quality.attention.length} ${quality.attention.length === 1 ? 'thing' : 'things'} worth fixing`}
                      </span>
                      <ChevronRight className="h-3 w-3 flex-none text-muted-foreground/60" />
                    </button>
                  </div>
                </div>
                {/* The grid gets the reclaimed height AND slightly tighter gutters — the panel is
                    284px wide, so 4px on each side is another few pixels of thumbnail. */}
                <div className="ms-scroll flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
                  <TrayToolbar
                    filters={tray.filters}
                    parsedSearch={tray.parsedSearch}
                    onSearch={tray.setSearch}
                    onToggleAxis={tray.toggleAxis}
                    onToggleFavourites={tray.toggleFavouritesOnly}
                    onReset={tray.reset}
                    active={tray.active}
                    matchCount={visiblePhotos.length}
                    totalCount={photos.length}
                    favouriteCount={favourites.count}
                    labelCounts={labels.counts}
                    removableCount={readyUnplaced.length}
                    removing={removingUnused}
                    onRemoveUnused={removeUnused}
                  />
                  {pickedId && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-studio-bright/40 bg-studio-soft px-3 py-2 text-xs text-foreground">
                      <Hand className="h-3.5 w-3.5 shrink-0 text-studio" />
                      <span className="flex-1">Photo picked up — tap an empty frame to place it.</span>
                      <button type="button" onClick={() => setPickedId(null)} className="font-medium text-muted-foreground hover:text-foreground">
                        Cancel
                      </button>
                    </div>
                  )}
                  <Tray
                    photos={visiblePhotos}
                    taskFor={taskFor}
                    filtered={tray.active}
                    placedIds={placed}
                    pickedId={pickedId}
                    onPick={(id) => setPickedId((c) => (c === id ? null : id))}
                    onEdit={setEditingPhoto}
                    onDeleted={onPhotoDeleted}
                    onRetryUpload={uploads.retry}
                    onCancelUpload={uploads.cancel}
                    onImageError={reportFailure}
                    isSelected={(id) => sel.has({ kind: 'photo', photoId: id })}
                    onSelect={(id, mods, orderedIds) =>
                      sel.pick(
                        { kind: 'photo', photoId: id },
                        mods,
                        orderedIds.map((pid) => ({ kind: 'photo', photoId: pid }) as SelectionTarget),
                      )
                    }
                    onContextMenu={(e, id) => {
                      // Right-clicking OUTSIDE the current selection re-targets it; right-clicking
                      // inside keeps it, so a menu can act on the whole group.
                      if (!sel.has({ kind: 'photo', photoId: id })) sel.pick({ kind: 'photo', photoId: id });
                      contextMenu.open(e, [
                        { id: 'mark', commands: [cmd.commands.toggleFavourite] },
                        // The triage marks, generated from the vocabulary — adding a fifth mark
                        // never means editing this menu.
                        {
                          id: 'labels',
                          commands: [...PHOTO_LABELS.map((k) => cmd.commands[`label:${k}`]), cmd.commands['label:clear']],
                        },
                        { id: 'edit', commands: [cmd.commands.rotatePhotos] },
                        { id: 'place', commands: [cmd.commands.removeFromPage] },
                        { id: 'danger', commands: [cmd.commands.deletePhotos] },
                      ]);
                    }}
                    isFavourite={favourites.isFavourite}
                    onToggleFavourite={favourites.toggle}
                    labelOf={labels.labelOf}
                    /* Cross-page drag: the tray publishes its drags and accepts drops back. */
                    onDragStartPhoto={(id) => drag.begin({ photoIds: [id], origin: { from: 'tray' } })}
                    onDragEndPhoto={drag.end}
                    dragActive={drag.dragging}
                    onDropToTray={(photoId) => {
                      // Dropping onto the tray means "take it off the page" — expressed as the
                      // SAME command the keyboard and context menu use, so history behaves
                      // identically however the user asks for it.
                      const frame = findFrameHolding(blocks, photoId);
                      if (frame) api.batch(() => api.clearFrames([frame]));
                      drag.end();
                    }}
                    onEmptyPointerDown={marquee.begin}
                    marqueeOverlay={<MarqueeBox rect={marquee.rect} />}
                    onGrid={(el, geom) => {
                      trayGridRef.current = el;
                      marqueeGeom.current = geom;
                    }}
                  />
                </div>
              </>
            )}

            {!coverFocused && railTab === 'layouts' && (
              <LayoutsPanel
                hasTarget={!!block}
                canAddTemplate={(t) => canAdd(blocks, size, t)}
                onAddBlock={addBlock}
                onApplyPreset={applyPreset}
                memory={layoutMemory}
                suggestions={suggestions}
              />
            )}

            {/* Album Quality — a dockable panel, never a dialog. Available on the cover too,
                because a cover has quality problems of its own. */}
            {railTab === 'quality' && (
              <QualityPanel
                report={quality}
                stats={statistics}
                onGoToIssue={goToIssue}
                onOpenReview={() => setReviewOpen(true)}
              />
            )}

            {/* Cover artwork — cover-only. Applying copies the template's CoverConfig into
                cover_config through `cover.update`, which migrates it to the object model on the
                way in, so an admin template authored before Cover Editor 2.0 lands as objects. */}
            {coverFocused && railTab === 'templates' && (
              <div className="ms-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {/*
                  COVER ARTWORK — the admin-managed PNG covers (0023). This gallery used to live
                  inside the deprecated cover panel's "Artwork" source tab; it belongs in the rail
                  with every other catalog of things you can add, which is where it is now.
                  Choosing one sets `albums.cover_template_id`; the objects on top are untouched.
                */}
                <h2 className="mb-3 text-[13px] font-semibold tracking-tight text-foreground">Cover artwork</h2>
                <div className="mb-5 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCoverTemplate(null)}
                    title="No artwork — use a photo or a background"
                    className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-muted ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                      coverId === null ? 'ring-2 ring-studio' : 'ring-border hover:ring-studio-bright/50'
                    }`}
                  >
                    <span className="absolute inset-0 grid place-items-center px-1 text-center text-[10px] font-medium text-muted-foreground">
                      None
                    </span>
                  </button>
                  {covers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCoverTemplate(c.id)}
                      title={c.name}
                      className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-muted ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                        coverId === c.id ? 'ring-2 ring-studio' : 'ring-border hover:ring-studio-bright/50'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.thumbUrl} alt={c.name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>

                <h2 className="mb-3 text-[13px] font-semibold tracking-tight text-foreground">Cover templates</h2>
                <CoverTemplatesPanel
                  templates={coverTemplates}
                  stickerUrlFor={stickerUrlFor}
                  hasExistingDesign={isCustomCover(coverConfig)}
                  onApply={(cfg) => {
                    cover.update(cfg);
                    cover.setSelection(NO_SELECTION);
                  }}
                />
              </div>
            )}

            {/* The add-object rails are surface-agnostic: the same panels, pointed at whichever
                canvas has focus. The cover's target is its FOCUSED FACE (`cover.side`). */}
            {railTab === 'text' && (
              <TextPanel hasTarget={coverFocused ? true : !!block} onAdd={coverFocused ? cover.addText : addText} />
            )}

            {railTab === 'stickers' && (
              <StickersPanel
                catalog={stickerCatalog}
                hasTarget={coverFocused ? cover.side !== 'spine' : !!block}
                onAdd={coverFocused ? cover.addSticker : addPageSticker}
              />
            )}

            {railTab === 'backgrounds' && (
              <BackgroundsPanel
                current={coverFocused ? cover.background : block?.background ?? null}
                /* The spine has its own backdrop now, so every cover face is a valid target. */
                hasTarget={coverFocused ? true : !!block}
                onApply={(bg) => (coverFocused ? cover.applyBackground(bg) : block && api.setBackground(block.key, bg))}
                /* On the cover, "all" means the three cover faces — front, spine and back. */
                onApplyAll={(bg) => (coverFocused ? cover.setAllBackgrounds(bg) : api.setBackgroundAll(bg))}
                surface={coverFocused ? 'cover' : 'page'}
              />
            )}

            {railTab === 'qr' && (
              <QrPanel hasTarget={coverFocused ? cover.side !== 'spine' : !!block} onAdd={coverFocused ? cover.addQr : addQr} />
            )}
          </aside>
        </div>

        {/* CENTER — canvas. On phone it owns the full width; the bottom padding keeps the
            filmstrip and page controls clear of the fixed tool tab bar. */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* canvas strip — one linear sequence: Cover → Spread 1 → … */}
          <div className="flex h-11 flex-none items-center justify-between gap-2 border-b border-border/60 px-4">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={goPrev} disabled={coverFocused} aria-label="Previous page" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[6rem] text-center text-[12px] font-medium tabular-nums text-muted-foreground">
                {coverFocused ? 'Cover' : `Spread ${cur + 1} / ${Math.max(1, blocks.length)}`}
              </span>
              <button type="button" onClick={goNext} disabled={coverFocused ? blocks.length === 0 : cur >= blocks.length - 1} aria-label="Next page" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {!coverFocused && blocks.length > 0 && (
              <div className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs">
                <button type="button" onClick={() => setEditLayout('focus')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${editLayout === 'focus' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Square className="h-3.5 w-3.5" /> Edit
                </button>
                <button type="button" onClick={() => setEditLayout('grid')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${editLayout === 'grid' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Rows3 className="h-3.5 w-3.5" /> All pages
                </button>
              </div>
            )}
          </div>

          {/* canvas body */}
          {coverFocused ? (
            /* Eight props instead of twenty-four. Everything the canvas needs to MUTATE now
               lives on `cover`; what is left is what it needs to DRAW. */
            <CoverCanvas
              cover={cover}
              frontImageUrl={coverImageUrl}
              backImageUrl={backCoverImageUrl}
              size={size}
              zoomPct={zoomPct}
              stickerUrlFor={stickerUrlFor}
              /* The SAME resolver the page canvas uses for its overlays — one photo, one URL,
                 one set of edits, wherever it is placed. */
              photoFor={photoForOverview}
              onPickOverlayPhoto={(overlayId) => setCoverPhotoPicker({ side: cover.side, target: 'overlay', overlayId })}
              onFaceEl={(el) => {
                pageElRef.current = el;
              }}
            />
          ) : (
          /**
           * THE CANVAS, EXPANDED (Pass 2). With the 300px inspector gone the spread has the
           * width, so the padding tightens (a big page needs less framing, not more) and the
           * focus view's max width grows from 1100px to 1400px — the reclaimed space becomes
           * PAGE rather than margin, which was the point of removing the panel.
           *
           * A pointer-down anywhere on the empty canvas finishes crop mode: "click outside to
           * finish" with no modal, no confirm, no Done button required.
           */
          <div
            ref={canvas.ref}
            className="ms-scroll relative min-h-0 flex-1 overflow-auto p-4 lg:p-7"
            /**
             * CLICKING OFF THE BOOK DESELECTS.
             *
             * The pasteboard around the spread used to be inert: an overlay stayed selected, with
             * its toolbar up, no matter where you clicked next. Deselecting is a real intention
             * and it needs a target.
             *
             * The test is DOM containment against the live page element, not coordinates and not
             * a timer: if the gesture started inside the spread it belongs to the spread, and this
             * does nothing. Everything else on the canvas — pasteboard, padding, the empty area
             * beside a zoomed-out page — is outside the book and clears the selection.
             *
             * Nothing else needs to opt out. `Movable.begin` and both toolbars already
             * `stopPropagation` on pointerdown, so a click on an object, a handle or a bar never
             * reaches this handler at all; and clicking blank paper INSIDE the spread already
             * deselects through `BlockCard`'s own `onSelect({ kind: 'none' })`.
             */
            onPointerDown={(e) => {
              if (crop.target) crop.end();
              const page = pageElRef.current;
              if (page && page.contains(e.target as Node)) return;
              setSelection(NO_SELECTION);
              sel.clear();
            }}
          >
            {blocks.length === 0 ? (
              <EmptyCanvas
                blueprintMode={blueprintMode}
                onBuild={() => setBuildMethodOpen(true)}
                onAdd={() => addBlock('single-pair')}
                canBuild={enginePhotos.length > 0}
                hasPhotos={photos.length > 0}
                awaitingShapes={photos.length > 0 && enginePhotos.length === 0}
              />
            ) : editLayout === 'grid' ? (
              <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
                {blocks.map((b, i) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => {
                      setCurrent(i);
                      setEditLayout('focus');
                    }}
                    className={`group relative overflow-hidden bg-white shadow-[0_2px_4px_rgb(16_24_20/0.06),0_18px_44px_-24px_rgb(16_24_20/0.4)] ring-1 transition-all duration-200 hover:-translate-y-1 ${i === cur ? 'ring-2 ring-studio' : 'ring-black/[0.04] hover:ring-studio-bright/50'}`}
                    style={{ containerType: 'inline-size' }}
                  >
                    <div className="relative w-full" style={{ aspectRatio: pairA }}>
                      <PairContent block={b} photoFor={photoForOverview} stickerUrlFor={stickerUrlFor} />
                      {showGutter && <PrintGutter />}
                    </div>
                    <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-foreground/55 text-[11px] font-semibold text-white backdrop-blur-sm">{i + 1}</span>
                  </button>
                ))}
              </div>
            ) : (
              block && (
                /* fit × zoom. At 100% the whole spread is visible with no scrolling; zooming past
                   it overflows the canvas deliberately, which is what a zoom control is for. The
                   percentage fallback covers the single frame before the box is measured. */
                <div
                  className="mx-auto"
                  style={
                    fitWidth
                      ? { width: (fitWidth * zoomPct) / 100 }
                      : { width: `${zoomPct}%`, maxWidth: zoomPct <= 100 ? `${SPREAD_MAX_PX}px` : 'none' }
                  }
                >
                  <BlockCard
                    api={api}
                    block={block}
                    index={cur}
                    blocks={blocks}
                    photoMap={photoMap}
                    taskFor={taskFor}
                    availablePhotos={availablePhotos}
                    selection={selection}
                    /**
                     * Clicking empty page area clears BOTH stores. Previously it reset only the
                     * single-element selection, so the multi-select store could keep holding an
                     * overlay the user had visibly deselected — and a Delete keystroke would
                     * then act on it. "Deselect" now means deselect.
                     */
                    onSelect={(s) => {
                      setSelection(s);
                      if (s.kind === 'none') sel.clear();
                      // Selecting anything else finishes an in-progress crop — the crop layer
                      // stops propagation while it is active, so this only fires for a
                      // deliberate click elsewhere, which is exactly "click outside to finish".
                      if (crop.target) crop.end();
                    }}
                    /**
                     * Multi-selection on the canvas. `onSelectTarget` carries the modifier state
                     * to the SAME selection store the tray uses; the legacy single `onSelect`
                     * stays so the inspector keeps describing the primary target unchanged.
                     */
                    isTargetSelected={sel.has}
                    onSelectTarget={(target, mods) => sel.pick(target, mods, allTargets())}
                    drag={drag}
                    onFrameContextMenu={(e, target) => {
                      if (!sel.has(target)) sel.pick(target);
                      contextMenu.open(e, [
                        { id: 'photo', commands: [cmd.commands.rotatePhotos, cmd.commands.removeFromPage] },
                        // Marking works from the CANVAS too — the photo you want to flag is
                        // usually the one you're looking at, not one you have to find in the tray.
                        {
                          id: 'labels',
                          commands: [
                            cmd.commands.toggleFavourite,
                            ...PHOTO_LABELS.map((k) => cmd.commands[`label:${k}`]),
                            cmd.commands['label:clear'],
                          ],
                        },
                        { id: 'page', commands: [cmd.commands.duplicatePage, cmd.commands.clearPlacement] },
                        { id: 'danger', commands: [cmd.commands.deletePhotos] },
                      ]);
                    }}
                    onEditPhoto={openEditor}
                    onQuickCrop={openQuickCrop}
                    onPlacePhoto={placeOnCanvas}
                    stickerUrlFor={stickerUrlFor}
                    pickActive={!!pickedId}
                    onTapPlaceBase={(slot: BaseSlot) => {
                      if (!pickedId) return;
                      // Tap-to-place is a placement like any other — same seam, so it replaces
                      // an occupied slot and reports the swap exactly as a drop does.
                      placeOnCanvas(pickedId, { blockKey: block.key, slot });
                      setPickedId(null);
                    }}
                    showGuides={showGuides}
                    showGutter={showGutter}
                    readinessOf={readinessOf}
                    onPageEl={(el) => {
                      pageElRef.current = el;
                    }}
                    /* Press-and-hold on a photo — the same entry point the Crop button uses. */
                    onBeginCrop={beginCropOn}
                    cropTarget={crop.target}
                    cropHandlers={crop.handlers}
                  />
                </div>
              )
            )}

            {/* The floating add-page button is gone (Pass 3): page creation lives in the page
                strip's Add tile now, so there is exactly one place pages are managed. */}
          </div>
          )}

          {/* LAYOUT DRIFT — only ever appears when a few photos turned out to be a different
              shape than the browser judged AND the user has since edited the layout. Their work
              is never overwritten silently; this simply offers the rebuild and can be dismissed. */}
          {optimisticLayout.driftedCount > 0 && (
            <div className="animate-scale-in absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-elevated">
              <p className="text-[12.5px] leading-tight text-muted-foreground">
                <span className="font-medium text-foreground">
                  {optimisticLayout.driftedCount} photo{optimisticLayout.driftedCount === 1 ? '' : 's'} turned out a different shape.
                </span>{' '}
                Rebuild the layout?
              </p>
              <div className="flex flex-none items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => optimisticLayout.setDriftedCount(0)}>
                  Keep mine
                </Button>
                <Button size="sm" className={STUDIO_PRIMARY} onClick={rebuildFromVerified}>
                  Rebuild
                </Button>
              </div>
            </div>
          )}

          {/*
            BULK ACTION BAR — appears only with a multi-selection, and renders the very same
            command objects the keyboard and context menu invoke. "Fill from tray" is Batch
            Replace: it zips the selected frames against the currently-selected tray photos (or,
            failing that, the unplaced ones in tray order) in a single undoable step.
          */}
          <SelectionBar
            count={sel.selection.targets.length}
            commands={[cmd.commands.rotatePhotos, cmd.commands.removeFromPage, cmd.commands.deletePhotos]}
            primaryLabel={
              cmd.occupiedFrames.length < selectedFrames(sel.selection).length ? 'Fill from tray' : undefined
            }
            onPrimary={() => {
              const chosen = selectedPhotoIds(sel.selection);
              const pool = chosen.length > 0 ? chosen : availablePhotos.map((p) => p.id);
              cmd.batchReplace(pool);
            }}
            onDismiss={sel.clear}
          />

          {/*
            THE FLOATING CONTEXT BAR — on BOTH surfaces now.

            The cover used to be the exception ("the cover has its own panel"), and that exception
            was the permanent sidebar. It is gone: a cover object gets the same floating toolbar a
            page object gets, from the same components. `CoverContextBar` only decides which bar
            a cover selection deserves — the Text / Sticker / QR / Photo bars themselves are the
            shared ones, reached through `ObjectBar`.
          */}
          {coverFocused && (
            <CoverContextBar
              anchor={barAnchor}
              cover={cover}
              selectedPhoto={coverSelectedPhoto}
              photoMap={photoMap}
              pageAspect={pageA}
              onPickPhoto={() => setCoverPhotoPicker({ side: cover.side, target: 'image' })}
              onOpenArtwork={() => setRailTab('templates')}
              onAddOverlay={() => {
                // Create the CONTAINER, then open the picker for it — the same two steps the page
                // canvas takes, so an empty frame is a real, selectable object either way.
                const id = cover.addOverlay(null, 'center');
                setCoverPhotoPicker({ side: cover.side, target: 'overlay', overlayId: id });
              }}
              onOpenRail={setRailTab}
              onCrop={() => setCoverImageEditor(cover.side)}
              cropping={false}
              onEndCrop={() => setCoverImageEditor(null)}
              onOpenProperties={() => setPropsPanelOpen((v) => !v)}
              propertiesOpen={propsPanelOpen && !!coverPropsPanelContent}
              onEscape={() => cover.setSelection(NO_SELECTION)}
            />
          )}

          {!coverFocused && editLayout === 'focus' && block && (
            <ContextBar
              anchor={barAnchor}
              overlayAnchor={overlayAnchor}
              block={block}
              index={cur}
              total={blocks.length}
              size={size}
              api={api}
              commands={cmd}
              selection={selection}
              onSelect={setSelection}
              photoMap={photoMap}
              selectedPhoto={selectedFramePhoto}
              pairAspect={pairA}
              showGuides={showGuides}
              onToggleGuides={() => setShowGuides((v) => !v)}
              onReplace={(t) =>
                setPickerFor(t.overlayId ? { kind: 'overlay', overlayId: t.overlayId } : { kind: 'base', slot: t.slot ?? 'left' })
              }
              onCrop={startCrop}
              cropping={!!crop.target}
              onEndCrop={crop.end}
              onAddText={() => addText('heading')}
              onAddPhotoOverlay={addPageOverlay}
              onAddQr={() => addQr('')}
              onOpenLayouts={() => setRailTab('layouts')}
              onCycleLayout={cycleLayout}
              layoutLabel={layoutLabel}
              onLayoutDensity={stepLayoutDensity}
              canFewerPhotos={!!densityOption(-1)}
              canMorePhotos={!!densityOption(1)}
              canCycleLayout={canCycleLayout}
              cyclePosition={
                layoutCycle?.blockKey === block.key && layoutCycle.index > 0
                  ? `${layoutCycle.index + 1}/${cycleSteps.length}`
                  : null
              }
              onOpenProperties={() => setPropsPanelOpen((v) => !v)}
              propertiesOpen={propsPanelOpen && !!propsPanelContent}
              onEscape={() => {
                setSelection(NO_SELECTION);
                sel.clear();
              }}
            />
          )}

          {/* message toast — over either canvas */}
          {message && (
            <div className={`animate-scale-in pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-xl border px-3.5 py-2 text-[13px] font-medium shadow-elevated ${message.kind === 'ok' ? 'border-studio/25 bg-studio-soft text-studio' : 'border-destructive/20 bg-destructive/5 text-destructive'}`}>
              {message.text}
            </div>
          )}
        </main>

        {/*
          RIGHT — ONE docked properties panel, for every surface.

          It hosts the detailed controls for whatever is selected — photo adjustments, advanced
          typography, sticker and QR settings on a content page; spine, text, sticker, QR and the
          whole cover design on the cover. It exists only while open AND the selection has
          something detailed to show, and the canvas takes the width back the moment it closes.

          The cover's permanent 300px sidebar is gone. It was the last place the builder still
          behaved like two applications, and nothing about it was load-bearing: the inspectors it
          rendered were already the shared, callback-driven ones, so unifying was a change of HOST,
          not of editing logic.
        */}
        {propsPanelOpen && panelContent && (
          <PropertiesPanel title={panelContent.title} onClose={() => setPropsPanelOpen(false)}>
            {panelContent.node}
          </PropertiesPanel>
        )}
      </div>

      {/* BOTTOM — timeline (the Cover is page 0, then the content spreads) */}
      <div className="flex flex-none items-center gap-3 border-t border-border/70 bg-card px-4 py-2 max-md:gap-2 max-md:px-2 max-md:py-1.5">
        {/* Cover thumbnail — page 0 (fixed first, not reorderable/deletable) */}
        <button
          type="button"
          onClick={focusCover}
          aria-current={coverFocused ? 'true' : undefined}
          title="Cover — back · spine · front"
          className={`group relative h-[58px] w-[92px] flex-none overflow-hidden rounded-lg bg-white ring-2 max-md:h-[42px] max-md:w-[66px] transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${coverFocused ? 'ring-studio shadow-card' : 'ring-border'}`}
        >
          <div className="absolute inset-0">
            <CoverSpread
              config={coverConfig}
              title={albumTitle}
              frontImageUrl={coverImageUrl}
              backImageUrl={backCoverImageUrl}
              size={size}
              pageAspect={pageA}
              stickerUrlFor={stickerUrlFor}
            />
          </div>
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-1 pb-0.5 pt-2 text-center text-[8px] font-semibold uppercase tracking-wide text-white">
            Cover
          </span>
        </button>
        <span className="h-9 w-px flex-none bg-border/70" />
        <div className="flex flex-none items-center gap-2.5">
          <span className="flex items-baseline gap-1 text-sm font-semibold tabular-nums">
            <span className={remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-studio' : 'text-foreground'}>{consumed}</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-muted-foreground">{size}</span>
          </span>
          <span className="hidden text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 sm:inline">pages</span>
        </div>
        <div className="min-w-0 flex-1">
          <Navigator
            blocks={blocks}
            photoMap={photoMap}
            stickerUrlFor={stickerUrlFor}
            photoStateFor={photoStateFor}
            current={coverFocused ? -1 : cur}
            canAddMore={canAddMore}
            collapsed={navCollapsed}
            onToggleCollapsed={() => setNavCollapsed((v) => !v)}
            dragActive={drag.dragging}
            /**
             * CROSS-PAGE MOVE. Dropping a photo on a page thumb puts it on that spread.
             *
             * WHERE depends on what the spread is. A page that uses base slots (a legacy album, a
             * panorama, or one a preset laid out) takes it into the first empty slot, or replaces
             * the first if it is full — unchanged, through the same `placePhoto` command as every
             * other placement. A plain page has no base slots to fill, so the photo becomes an
             * OVERLAY, which is how a photo reaches a page everywhere else in the builder; doing
             * anything else here would quietly re-attach a full-page image to a page that never
             * offered one.
             */
            onDropPhotoOnPage={(blockKey, photoId) => {
              const target = blocks.find((b) => b.key === blockKey);
              if (!target) return;
              drag.end();
              if (activeBaseSlots(target).length === 0) {
                api.addOverlay(blockKey, photoId);
                return;
              }
              const slots = activeBaseSlots(target);
              const emptyIndex = slots.findIndex((_, i) => !target.photoIds[i]);
              const slot = slots[emptyIndex >= 0 ? emptyIndex : 0];
              cmd.placePhoto(photoId, { blockKey, slot });
            }}
            onJump={focusBlock}
            onReorder={api.reorderBlocks}
            onInsertAfter={insertAfter}
            onDuplicate={duplicateBlock}
            onDelete={api.removeBlock}
            /**
             * PAGE MANAGEMENT IN THE STRIP (Pass 3): the Add tile and its menu replace the old
             * floating add button, dispatching the same addBlock / duplicate / remove paths.
             */
            onAddSpread={addBlock}
            onOpenLayouts={coverFocused ? undefined : () => setRailTab('layouts')}
            currentKey={coverFocused ? null : (blocks[cur]?.key ?? null)}
            spreadLevels={quality.spreadLevels}
          />
        </div>

        {/* Preview — sits beside the Pages bar (Change 2). Same flipbook trigger; customer mode
            only (Blueprint mode keeps its Preview in the top toolbar). Styled as a prominent,
            slightly-darker brand-green CTA so the preview action is immediately noticeable. */}
        {!blueprintMode && (
          <>
            <span className="h-9 w-px flex-none bg-border/70" />
            <Button
              size="lg"
              onClick={() => setFlipbookOpen(true)}
              aria-label="Preview album"
              title="Preview album"
              className="flex-none gap-2 rounded-lg border-transparent bg-[hsl(150_48%_29%)] px-4 font-semibold max-md:px-3 text-studio-foreground shadow-[0_1px_2px_rgb(16_24_20/0.14),0_8px_20px_-8px_hsl(150_46%_22%/0.55)] transition-all duration-200 ease-glide hover:-translate-y-px hover:bg-[hsl(150_50%_25%)] hover:shadow-[0_3px_10px_rgb(16_24_20/0.18),0_16px_30px_-10px_hsl(150_46%_20%/0.6)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-2"
            >
              <Eye /> <span className="max-md:hidden">Preview</span>
            </Button>
          </>
        )}
      </div>

      {/* Modals — grouped in the modal host; this component only decides what is open. */}
      <PhotoModals
        editingPhoto={editingPhoto}
        editPlacement={editPlacement}
        onCloseEditor={() => setEditingPhoto(null)}
        onPhotoSaved={onPhotoSaved}
        coverImageEditor={coverImageEditor}
        coverConfig={coverConfig}
        photoMap={photoMap}
        pageAspect={pageA}
        onCloseCoverEditor={() => setCoverImageEditor(null)}
        onCoverImageEdit={(side, edit) => cover.patchImageEdit(edit, side)}
        quickCrop={quickCrop}
        onCloseQuickCrop={() => setQuickCrop(null)}
      />
      {flipbookOpen && (
        <Flipbook
          blocks={blocks}
          photoMap={photoMap}
          stickerUrlFor={stickerUrlFor}
          photoStateFor={photoStateFor}
          cover={{ imageUrl: coverImageUrl, backImageUrl: backCoverImageUrl, config: coverConfig, title: albumTitle, name: selectedCover?.name ?? albumTitle, size }}
          showGutter={showGutter}
          startPage={previewStartPage}
          onPageChange={(p) => {
            previewPageRef.current = p;
          }}
          onEditAlbum={closePreview}
          onClose={closePreview}
        />
      )}
      {/* REVIEW MODE — the album with the software taken away. Renders the same spreads through
          the same `PairContent`, and nothing on that surface can modify anything. */}
      {reviewOpen && (
        <ReviewMode
          blocks={blocks}
          photoFor={photoForOverview}
          stickerUrlFor={stickerUrlFor}
          cover={{
            config: coverConfig,
            title: albumTitle,
            frontImageUrl: coverImageUrl,
            backImageUrl: backCoverImageUrl,
            size,
          }}
          report={quality}
          albumId={albumId}
          startIndex={cur}
          showGutter={showGutter}
          onClose={() => setReviewOpen(false)}
          onGoToIssue={goToIssue}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      {/* Context menu — pure renderer over the command layer; holds no editing logic. */}
      <ContextMenu state={contextMenu.menu} onClose={contextMenu.close} />

      {/* The COVER's photo picker — the same `PhotoPicker` a page frame uses, so choosing a cover
          photo and choosing a page photo are one interaction. The cover prints at full size, so
          only processed photos are offered (the worker's sanitized master is the print source). */}
      {coverPhotoPicker && (
        <PhotoPicker
          title={
            coverPhotoPicker.target === 'overlay'
              ? 'Choose a photo for this overlay'
              : coverPhotoPicker.side === 'front'
                ? 'Choose the front cover photo'
                : 'Choose the back cover photo'
          }
          available={photos.filter((p) => p.status === 'ready')}
          onClose={() => setCoverPhotoPicker(null)}
          onPick={(id) => {
            if (coverPhotoPicker.target === 'overlay') {
              cover.replaceOverlay(`cover:${coverPhotoPicker.side}`, coverPhotoPicker.overlayId, id);
              cover.setSide(coverPhotoPicker.side);
              cover.setSelection({ kind: 'overlay', id: coverPhotoPicker.overlayId });
            } else {
              cover.setPhoto(id, coverPhotoPicker.side);
              cover.setSide(coverPhotoPicker.side);
              cover.setSelection({ kind: 'base', slot: 'image' });
            }
            setCoverPhotoPicker(null);
          }}
        />
      )}

      {/* The canvas's own photo picker, hosted here so the floating toolbar can open it.
          Same component the canvas has always used — see `PhotoPicker` in `_block`. */}
      {pickerFor && block && (
        <PhotoPicker
          title="Choose a photo"
          available={availablePhotos}
          onClose={() => setPickerFor(null)}
          onPick={(id) => {
            if (pickerFor.kind === 'base') api.assignBaseSlot(block.key, pickerFor.slot, id);
            else api.replaceOverlay(block.key, pickerFor.overlayId, id);
            setPickerFor(null);
          }}
        />
      )}

      {/* Submission validation (advisory) — checking overlay while saves flush, then the dialog. */}
      <LoadingOverlay open={checking} message="Checking your album…" />
      {validation && !confirmOpen && (
        <SubmitValidationDialog
          report={validation}
          submitting={submitting}
          onGoBack={() => setValidation(null)}
          onNavigate={navigateToIssue}
          onContinue={onDialogContinue}
        />
      )}
      {confirmOpen && (
        <ConfirmSubmitDialog submitting={submitting} onCancel={() => setConfirmOpen(false)} onConfirm={doSubmit} />
      )}
      {/* Resubmit confirmation (CHANGE 3) — review returns to Pending Review; album is locked again. */}
      {resubmitted && <ResubmittedDialog />}

      {/* Album Settings — the revisitable setup hub (General / Format / Photos / Builder). Reuses the
          builder's own surfaces (cover rail, Photos rail, Build-it-for-me picker) — no duplicate UI. */}
      {settingsOpen && (
        <AlbumSettings
          albumId={albumId}
          title={albumTitle}
          destination={destination}
          travelDates={travelDates}
          description={description}
          productName={productName}
          pageCount={size}
          coverLabel={coverId ? covers.find((c) => c.id === coverId)?.name ?? 'Selected cover' : 'Custom cover'}
          photoCount={photos.length}
          lastSavedAt={lastSaved}
          dirty={api.dirty}
          validation={(() => {
            // Live report from the SAME central service the submit gate + PDF use (never a new impl).
            const r = evaluateAlbum({ size, blocks, cover: { activeTemplate: !!coverId, config: coverConfig, title: albumTitle } });
            return { score: r.statistics.score, printReady: r.printReady };
          })()}
          onClose={() => setSettingsOpen(false)}
          /**
           * THE READ HALF OF THE TWO-WAY BINDING. Renaming the album in Settings retitles the
           * cover immediately — `applyTitle` pushes the new words into the `role: 'title'` object,
           * so the canvas, the preview and the PDF all say the new name without a reload.
           */
          onTitleSaved={(t) => {
            setAlbumTitle(t);
            cover.applyTitle(t);
          }}
          onEditCover={focusCoverForEditing}
          onOpenPhotos={() => { setCoverFocused(false); setRailTab('images'); }}
          onOpenBuildMethods={() => setBuildMethodOpen(true)}
          showGutter={showGutter}
          onShowGutterChange={setShowGutter}
        />
      )}

      {/* Unsaved-changes exit guard (CHANGE 4/5) — Save & Leave (full flush) / Leave / Cancel. */}
      {exitConfirmOpen && (
        <ExitGuardDialog
          reviewMode={reviewMode}
          exiting={exiting}
          error={message?.kind === "err" ? message.text : null}
          onSaveAndLeave={confirmSaveAndLeave}
          onLeaveWithout={confirmLeaveWithout}
          onCancel={() => setExitConfirmOpen(false)}
        />
      )}

      {/* "Build it for me" — the SAME Auto Create / Choose Blueprint / Custom workflow as the wizard. */}
      {buildMethodOpen && (
        <BuildMethod
          albumSize={size}
          uploaded={enginePhotos.length}
          unprocessed={unprocessedCount}
          defaultTarget={defaultBlueprint}
          blueprintCount={blueprints.length}
          onFullAuto={runFullAuto}
          onChoose={() => {
            setBuildMethodOpen(false);
            setBpPickerOpen(true);
          }}
          onFillEmpty={() => generate('fill', 0)}
          onReplaceAll={() => generate('build', 0)}
          onRandomize={() => generate('suggest', 0)}
          onUploadMore={() => {
            setBuildMethodOpen(false);
            setRailTab('images');
          }}
          onClose={() => setBuildMethodOpen(false)}
        />
      )}
      {bpPickerOpen && (
        <BlueprintPicker
          blueprints={blueprints}
          uploaded={enginePhotos.length}
          busy={false}
          onApply={(id, autoPlace) => {
            const bp = blueprints.find((b) => b.id === id);
            if (bp) applyBlueprintInBuilder(bp, autoPlace);
          }}
          onClose={() => setBpPickerOpen(false)}
        />
      )}

      {/* Blueprint Mode exit confirmation (0046) — only when there are unsaved changes. */}
      {exitDialogOpen && (
        <ExitBlueprintDialog
          saving={blueprintSaving}
          onSave={async () => {
            const ok = await saveBlueprint();
            if (ok) await doExitBlueprint();
          }}
          onDiscard={doExitBlueprint}
          onCancel={() => setExitDialogOpen(false)}
        />
      )}
      {proposal && (
        <Proposal
          title={proposal.title}
          blocks={proposal.blocks}
          photoMap={photoMap}
          cover={previewCover}
          summary={proposal.summary}
          canRegenerate={proposal.kind === 'build' || proposal.kind === 'suggest'}
          onAccept={acceptProposal}
          onRegenerate={() => generate(proposal.kind, proposal.strategy + 1)}
          onCancel={() => setProposal(null)}
        />
      )}
    </div>
  );
}

/**
 * Compact photo-placement stat (builder Images panel).
 *
 * Was a 52px tile with the value stacked over the label; now a ~22px ROW with the label left and
 * the value right. Same four facts, a quarter of the height, and the numbers line up in a column
 * (`tabular-nums`) so the set can be scanned as a group rather than read one tile at a time.
 * Borders come from the parent's hairline grid — each cell pays for none of its own chrome.
 */
function PhotoStat({ label, value, tone = 'ok' }: { label: string; value: number; tone?: 'ok' | 'warning' | 'muted' }) {
  const toneCls =
    tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-1.5 bg-card px-2 py-1">
      <span className="truncate text-[10.5px] text-muted-foreground">{label}</span>
      <span className={`flex-none text-[12px] font-semibold tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

function EmptyCanvas({
  blueprintMode,
  onBuild,
  onAdd,
  canBuild,
  hasPhotos,
  awaitingShapes,
}: {
  blueprintMode?: boolean;
  onBuild: () => void;
  onAdd: () => void;
  canBuild: boolean;
  /** Any photos at all in the tray. */
  hasPhotos?: boolean;
  /** Photos exist but none has a usable shape yet (HEIC still processing). */
  awaitingShapes?: boolean;
}) {
  return (
    <div className="mx-auto mt-6 max-w-md animate-scale-in rounded-2xl border border-dashed border-border bg-card/70 p-12 text-center max-md:mt-3 max-md:p-6">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-muted-foreground ring-1 ring-border">
        <LayoutGrid className="h-6 w-6" />
      </div>
      {blueprintMode ? (
        <>
          <p className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">Design your blueprint</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Add pages, then arrange layouts, overlay slots, text and stickers. Photos aren&rsquo;t added here — each customer fills the slots with their own.
          </p>
          <div className="mt-6 flex items-center justify-center">
            <Button size="sm" onClick={onAdd} className={STUDIO_PRIMARY}>
              <Plus /> Add a page
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Three distinct openings, because the right next step differs: no photos yet, photos
              whose shape we can't know yet, or ready to arrange. */}
          <p className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">
            {!hasPhotos ? 'Start your story' : awaitingShapes ? 'Getting your photos ready' : 'Ready when you are'}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            {/*
              "on the left" is only true where the panel IS on the left. Desktop keeps its exact
              original sentence; the phone, where the panel is a bottom sheet, gets the same
              sentence with the direction it can actually follow. Two spans rather than one
              rewritten string, so the desktop copy is untouched.
            */}
            {!hasPhotos ? (
              <>
                <span className="max-md:hidden">
                  Add photos on the left — you can start placing them the moment you pick them, while they upload.
                </span>
                <span className="md:hidden">
                  Add photos from the Images tab — you can start placing them the moment you pick them, while they upload.
                </span>
              </>
            ) : awaitingShapes
                ? 'We’re preparing your photos. You can build pages by hand now, and let us arrange them once they’re ready.'
                : 'Add a single page (a photo on each side) or a double page (one image across the fold) — or let us arrange your photos.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button size="sm" onClick={onBuild} disabled={!canBuild} className={STUDIO_PRIMARY}>
              <Wand2 /> Build it for me
            </Button>
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus /> Start manually
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

