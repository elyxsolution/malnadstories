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
  BookOpen,
  Copy,
  LayoutGrid,
  Rows3,
  Wand2,
  MessageSquareWarning,
  ChevronLeft,
  ChevronRight,
  BookImage,
  Eye,
} from 'lucide-react';
import Uploader, { type Photo } from './_uploader';
import Tray from './_tray';
import TrayToolbar, { type TrayFilter } from './_tray-toolbar';
import BlockCard from './_block';
import SubmitValidationDialog from './_submit-validation-dialog';
import ConfirmSubmitDialog from './_confirm-submit-dialog';
import { evaluateAlbum, type AlbumValidationReport, type IssueAction } from '@/lib/albums/validation';
import { LoadingOverlay } from '@/components/loading';
import PairContent from './_pair-frame';
import Navigator from './_navigator';
import Inspector from './_inspector';
import BuilderHeader from './_header';
import CanvasToolbar from './_toolbar';
import { BlueprintHeader, ExitBlueprintDialog, type BlueprintMeta } from './_blueprint-chrome';
import LayoutsPanel from './_panel-layouts';
import BackgroundsPanel from './_panel-backgrounds';
import QrPanel from './_panel-qr';
import TextPanel from './_panel-text';
import ShortcutsOverlay from './_shortcuts';
import BuildMethod, { type BuilderBlueprint } from './_build-method';
import BlueprintPicker from '../../new/_blueprint-picker';
import Proposal from './_proposal';
import CoverCanvas, { COVER_NO_SELECTION, type CoverSelection, type CoverSide } from './_cover-canvas';
import { CoverSpread } from './_cover-render';
import CoverPanel from './_panel-cover';
import CoverTemplatesPanel, { type BuilderCoverTemplate } from './_panel-cover-templates';
import StickersPanel from './_panel-stickers';
import { TextInspector, StickerInspector, QrInspector, SpineInspector } from './_element-inspectors';
import PhotoEditor from './_photo-editor';
import QuickCrop from './_quick-crop';
import { useBlocks, NO_SELECTION, type Selection, type BaseSlot } from './_use-builder';
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
  requiredBaseCount,
  cryptoId,
  type Background,
  type Block,
  type EditConfig,
  type LayoutTemplate,
  type QrElement,
  type StickerElement,
  type TextElement,
  type TextVariant,
} from '@/lib/builder/model';
import { makeText, makeSticker, makeQr, type LayoutPreset } from '@/lib/builder/elements';
import { useBuilderDimensions } from './_dimensions';
import { autoAlignBlock, autoAlignCover } from '@/lib/builder/auto-align';
import { applyBlueprint } from '@/lib/builder/blueprint';
import { isCustomCover, type CoverConfig } from '@/lib/builder/cover';
import { type StickerCategory } from '@/lib/stickers';
import { saveLayout, submitAlbum, saveCoverDesign, savePhotoEdit } from '@/lib/actions/builder';
import { updateBlueprintFromAlbum, exitBlueprintDraft } from '@/lib/actions/admin/templates';
import { Button } from '@/components/ui/button';
import { type CoverOption } from '@/lib/covers';
import { type ActiveTemplate } from '@/lib/templates/catalog';
import { useWorkerGate } from '@/components/worker/use-worker-gate';
import { STUDIO_PRIMARY } from './_ui';

// The flipbook (react-pageflip) is a client-only modal — load it on demand and skip SSR so
// the library never touches `window` during render, and its bundle only ships when opened.
const Flipbook = dynamic(() => import('./_flipbook'), { ssr: false });

/** Custom-mode auto-fill kinds (Fill Empty / Replace All / Randomize). Replaces the old AssistKind. */
type LayoutKind = 'build' | 'fill' | 'suggest';

type RailTab = 'images' | 'layouts' | 'templates' | 'text' | 'stickers' | 'backgrounds' | 'qr';
// 'layouts' is content-page only; 'templates' (cover designs) is cover-only. The rail is filtered
// per mode below so each shows only its relevant tools.
const RAIL: { key: RailTab; label: string; Icon: typeof Images }[] = [
  { key: 'images', label: 'Images', Icon: Images },
  { key: 'layouts', label: 'Layouts', Icon: LayoutTemplateIcon },
  { key: 'templates', label: 'Templates', Icon: BookImage },
  { key: 'text', label: 'Text', Icon: TypeIcon },
  { key: 'stickers', label: 'Stickers', Icon: Sticker },
  { key: 'backgrounds', label: 'Backdrop', Icon: Palette },
  { key: 'qr', label: 'QR', Icon: QrCode },
];

export default function Builder({
  albumId,
  title,
  size,
  email,
  initialStatus,
  initialPhotos,
  initialBlocks,
  covers,
  initialCoverId,
  initialCoverConfig,
  initialReview,
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
  initialStatus: string;
  initialPhotos: Photo[];
  initialBlocks: Block[];
  covers: CoverOption[];
  initialCoverId: string | null;
  initialCoverConfig: CoverConfig;
  initialReview: { status: string; requestedChanges: string | null } | null;
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
  const { page: pageA, pair: pairA } = useBuilderDimensions();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const api = useBlocks(initialBlocks, pairA);
  const { blocks } = api;

  const [status, setStatus] = useState(initialStatus);
  const [review, setReview] = useState(initialReview);
  const [coverId, setCoverId] = useState<string | null>(initialCoverId);
  const [albumTitle, setAlbumTitle] = useState(title);
  const [coverConfig, setCoverConfig] = useState<CoverConfig>(initialCoverConfig);
  const coverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Blueprint Mode opens on Layouts (blueprints carry no photos); customer albums open on Images.
  const [railTab, setRailTab] = useState<RailTab>(blueprintDraftOf ? 'layouts' : 'images');
  // Cover is page 0 of one continuous editor: `coverFocused` swaps the canvas + inspector to
  // the cover; `current` is the focused content spread otherwise.
  const [coverFocused, setCoverFocused] = useState(false);
  const [coverSel, setCoverSel] = useState<CoverSelection>(COVER_NO_SELECTION);
  // Which cover page (front/back) the rail "add" + background controls target.
  const [activeSide, setActiveSide] = useState<CoverSide>('front');
  // Open the photo editor on the front/back cover image (crop/zoom/rotate stored in cover_config).
  const [coverImageEditor, setCoverImageEditor] = useState<CoverSide | null>(null);
  const [current, setCurrent] = useState(0);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [editLayout, setEditLayout] = useState<'focus' | 'grid'>('focus');
  const [zoomPct, setZoomPct] = useState(100);
  const [showGuides, setShowGuides] = useState(false);

  // ── Blueprint Mode (0046) — editing a reusable blueprint, not a customer album ──
  const blueprintMode = !!blueprintDraftOf;
  const [blueprintSaving, setBlueprintSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(blueprintMeta ? new Date(blueprintMeta.updatedAt).getTime() : null);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [traySearch, setTraySearch] = useState('');
  const [trayFilter, setTrayFilter] = useState<TrayFilter>('all');
  const [removingUnused, setRemovingUnused] = useState(false);

  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [quickCrop, setQuickCrop] = useState<{ photo: Photo; aspect: number; gutter: boolean } | null>(null);
  const [flipbookOpen, setFlipbookOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Submission validation (advisory, non-blocking): `checking` shows the "Checking your album…"
  // overlay while saves flush; `validation` holds the report that drives the informational dialog.
  const [checking, setChecking] = useState(false);
  const [validation, setValidation] = useState<AlbumValidationReport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { ensureReady, modal: workerModal } = useWorkerGate();

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const placed = useMemo(() => placedPhotoIds(blocks), [blocks]);
  const availablePhotos = useMemo(() => photos.filter((p) => p.status === 'ready' && !placed.has(p.id)), [photos, placed]);
  const availableIds = useMemo(() => availablePhotos.map((p) => p.id), [availablePhotos]);
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
  const canAddMore = remaining >= 2;

  // Reset element selection whenever the focused spread changes.
  useEffect(() => setSelection(NO_SELECTION), [cur, blocks.length]);

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

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!api.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [api.dirty]);

  // Poll processing photos.
  const hasPending = photos.some((p) => p.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/photos?albumId=${albumId}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          photos: { id: string; status: Photo['status']; url: string; thumbUrl: string; takenAt: string | null; width?: number | null; height?: number | null }[];
        };
        if (!active) return;
        setPhotos((prev) =>
          prev.map((p) => {
            const u = body.photos.find((x) => x.id === p.id);
            return u ? { ...p, status: u.status, url: u.url, thumbUrl: u.thumbUrl, takenAt: u.takenAt, width: u.width ?? null, height: u.height ?? null } : p;
          }),
        );
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [hasPending, albumId]);

  // ── tray ───────────────────────────────────────────────────────────────────
  const readyUnplaced = photos.filter((p) => p.status === 'ready' && !placed.has(p.id));

  // Photo indicators (capacity/placed/remaining/unused) — derived from existing state only.
  // "Remaining slots" = empty BASE frames across the current layout; "Unused" = ready photos
  // not yet placed. Reuses requiredBaseCount + placedPhotoIds; no new model.
  const placedCount = placed.size;
  const emptyBaseSlots = blocks.reduce(
    (s, b) => s + Math.max(0, requiredBaseCount(b.template) - b.photoIds.filter(Boolean).length),
    0,
  );
  // Blueprint/layout CAPACITY = every base + overlay photo slot across the current spreads.
  const totalSlots = blocks.reduce((s, b) => s + requiredBaseCount(b.template) + b.overlays.length, 0);
  const trayQuery = traySearch.trim().toLowerCase();
  const visiblePhotos = photos.filter((p) => {
    if (trayQuery && !p.filename.toLowerCase().includes(trayQuery)) return false;
    if (trayFilter === 'unplaced') return p.status === 'ready' && !placed.has(p.id);
    if (trayFilter === 'placed') return placed.has(p.id);
    if (trayFilter === 'processing') return p.status === 'pending';
    return true;
  });

  // ── photos ─────────────────────────────────────────────────────────────────
  const onUploaded = (photo: Photo) => setPhotos((prev) => [...prev, photo]);

  const onPhotoDeleted = (id: string) => {
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

  // Modal editor / quick crop persist via savePhotoEdit; we just sync local state.
  const onPhotoSaved = (photoId: string, edit: EditConfig) =>
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, edit } : p)));

  // Inspector: live (local) change then persist on release.
  const onPhotoChange = (photoId: string, edit: EditConfig) => onPhotoSaved(photoId, edit);
  const onPhotoCommit = (photoId: string, edit: EditConfig) => {
    void savePhotoEdit({ photoId, edit });
  };

  const openQuickCrop = (photoId: string, aspect: number, gutter: boolean) => {
    const p = photoMap.get(photoId);
    if (p) setQuickCrop({ photo: p, aspect, gutter });
  };
  const openEditor = (photoId: string) => {
    const p = photoMap.get(photoId);
    if (p) setEditingPhoto(p);
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
    api.duplicateBlock(key, size);
  };
  const applyPreset = (preset: LayoutPreset) => {
    if (!block) return;
    api.applyPreset(block.key, preset, availableIds);
    setMessage({ kind: 'ok', text: 'Layout applied — review it, then Save.' });
  };
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

  // ── cover ─────────────────────────────────────────────────────────────────────
  // Persist the whole cover design (debounced) — title + base template + config jsonb.
  const persistCover = useCallback(
    (next: { title: string; coverId: string | null; config: CoverConfig }) => {
      if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
      coverSaveTimer.current = setTimeout(async () => {
        if (!next.title.trim()) return; // title is required server-side; skip until typed
        const res = await saveCoverDesign({ albumId, title: next.title, coverTemplateId: next.coverId, config: next.config });
        if (!res.ok) setMessage({ kind: 'err', text: res.error });
      }, 500);
    },
    [albumId],
  );

  const updateCover = (patch: { title?: string; coverId?: string | null; config?: Partial<CoverConfig> }) => {
    const nextTitle = patch.title ?? albumTitle;
    const nextCoverId = patch.coverId !== undefined ? patch.coverId : coverId;
    const nextConfig = patch.config ? { ...coverConfig, ...patch.config } : coverConfig;
    if (patch.title !== undefined) setAlbumTitle(patch.title);
    if (patch.coverId !== undefined) setCoverId(patch.coverId);
    if (patch.config) setCoverConfig(nextConfig);
    persistCover({ title: nextTitle, coverId: nextCoverId, config: nextConfig });
  };

  // The FRONT cover image actually shown (preview + flipbook + print): chosen photo → template → none.
  const coverImageUrl = useMemo(() => {
    if (coverConfig.photoId) return photoMap.get(coverConfig.photoId)?.url ?? null;
    if (coverConfig.background) return null;
    return selectedCover?.url ?? null;
  }, [coverConfig.photoId, coverConfig.background, photoMap, selectedCover]);
  // The BACK cover image (its own uploaded photo; no admin artwork on the back).
  const backCoverImageUrl = useMemo(
    () => (coverConfig.back.photoId ? photoMap.get(coverConfig.back.photoId)?.url ?? null : null),
    [coverConfig.back.photoId, photoMap],
  );

  // ── cover elements — SIDE-aware (front = top-level config, back = config.back). All flow
  // through the existing debounced `updateCover` → saveCoverDesign, so persistence is unchanged.
  type SideArrays = { texts: TextElement[]; stickers: StickerElement[]; qrs: QrElement[] };
  const sideArrays = (side: CoverSide): SideArrays =>
    side === 'front'
      ? { texts: coverConfig.texts, stickers: coverConfig.stickers, qrs: coverConfig.qrs }
      : { texts: coverConfig.back.texts, stickers: coverConfig.back.stickers, qrs: coverConfig.back.qrs };
  const writeSide = (side: CoverSide, patch: Partial<SideArrays>) =>
    side === 'front'
      ? updateCover({ config: patch })
      : updateCover({ config: { back: { ...coverConfig.back, ...patch } } });

  const nudge = <T extends { x: number; y: number }>(el: T): T => ({ ...el, x: Math.min(1, el.x + 0.03), y: Math.min(1, el.y + 0.03) });
  const reorder = <T extends { id: string }>(arr: T[], id: string, dir: -1 | 1): T[] | null => {
    const next = [...arr];
    const i = next.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return null;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  // Text
  const addCoverText = (variant: TextVariant) => {
    const side = activeSide;
    const el = makeText(variant);
    writeSide(side, { texts: [...sideArrays(side).texts, el] });
    setCoverSel({ kind: 'text', side, id: el.id });
  };
  const patchCoverText = (side: CoverSide, id: string, patch: Partial<TextElement>) =>
    writeSide(side, { texts: sideArrays(side).texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const removeCoverText = (side: CoverSide, id: string) =>
    writeSide(side, { texts: sideArrays(side).texts.filter((t) => t.id !== id) });
  const duplicateCoverText = (side: CoverSide, id: string) => {
    const src = sideArrays(side).texts.find((t) => t.id === id);
    if (!src) return;
    const clone = nudge<TextElement>({ ...src, id: cryptoId() });
    writeSide(side, { texts: [...sideArrays(side).texts, clone] });
    setCoverSel({ kind: 'text', side, id: clone.id });
  };
  const reorderCoverText = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorder(sideArrays(side).texts, id, dir);
    if (next) writeSide(side, { texts: next });
  };

  // Stickers (cover page → square default via makeSticker at the product's page aspect)
  const addCoverSticker = (stickerId: string) => {
    const side = activeSide;
    const el = makeSticker(stickerId, pageA);
    writeSide(side, { stickers: [...sideArrays(side).stickers, el] });
    setCoverSel({ kind: 'sticker', side, id: el.id });
  };
  const patchCoverSticker = (side: CoverSide, id: string, patch: Partial<StickerElement>) =>
    writeSide(side, { stickers: sideArrays(side).stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const removeCoverSticker = (side: CoverSide, id: string) =>
    writeSide(side, { stickers: sideArrays(side).stickers.filter((s) => s.id !== id) });
  const duplicateCoverSticker = (side: CoverSide, id: string) => {
    const src = sideArrays(side).stickers.find((s) => s.id === id);
    if (!src) return;
    const clone = nudge<StickerElement>({ ...src, id: cryptoId() });
    writeSide(side, { stickers: [...sideArrays(side).stickers, clone] });
    setCoverSel({ kind: 'sticker', side, id: clone.id });
  };
  const reorderCoverSticker = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorder(sideArrays(side).stickers, id, dir);
    if (next) writeSide(side, { stickers: next });
  };

  // QR (square on the cover page — the product's page aspect)
  const addCoverQr = (data: string) => {
    const side = activeSide;
    const el = makeQr(data, { h: Math.min(1, 0.14 * pageA) }, pageA);
    writeSide(side, { qrs: [...sideArrays(side).qrs, el] });
    setCoverSel({ kind: 'qr', side, id: el.id });
  };
  const patchCoverQr = (side: CoverSide, id: string, patch: Partial<QrElement>) =>
    writeSide(side, { qrs: sideArrays(side).qrs.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const removeCoverQr = (side: CoverSide, id: string) =>
    writeSide(side, { qrs: sideArrays(side).qrs.filter((q) => q.id !== id) });
  const duplicateCoverQr = (side: CoverSide, id: string) => {
    const src = sideArrays(side).qrs.find((q) => q.id === id);
    if (!src) return;
    const clone = nudge<QrElement>({ ...src, id: cryptoId() });
    writeSide(side, { qrs: [...sideArrays(side).qrs, clone] });
    setCoverSel({ kind: 'qr', side, id: clone.id });
  };
  const reorderCoverQr = (side: CoverSide, id: string, dir: -1 | 1) => {
    const next = reorder(sideArrays(side).qrs, id, dir);
    if (next) writeSide(side, { qrs: next });
  };

  // Background applied to the active cover page (image takes precedence over a colour).
  const applyCoverBackground = (side: CoverSide, bg: Background | null) =>
    side === 'front'
      ? updateCover({ config: bg ? { background: bg, photoId: null } : { background: null } })
      : updateCover({ config: { back: { ...coverConfig.back, background: bg, photoId: bg ? null : coverConfig.back.photoId } } });

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
    setCoverSel(COVER_NO_SELECTION);
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
  // The side a selected element lives on (text/sticker/qr); null for none/spine.
  const coverSelSide: CoverSide | null =
    coverSel.kind === 'text' || coverSel.kind === 'sticker' || coverSel.kind === 'qr' ? coverSel.side : null;
  const coverSelectedText =
    coverSel.kind === 'text' ? sideArrays(coverSel.side).texts.find((t) => t.id === coverSel.id) ?? null : null;
  const coverSelectedSticker =
    coverSel.kind === 'sticker' ? sideArrays(coverSel.side).stickers.find((s) => s.id === coverSel.id) ?? null : null;
  const coverSelectedQr =
    coverSel.kind === 'qr' ? sideArrays(coverSel.side).qrs.find((q) => q.id === coverSel.id) ?? null : null;

  // ── Auto Align (toolbar) — tidies the active cover page / focused spread (text + stickers).
  const activeArrays = sideArrays(activeSide);
  const canAutoAlign = coverFocused
    ? activeArrays.texts.length + activeArrays.stickers.length > 0
    : !!block && block.texts.length + block.stickers.length > 0;
  const autoAlignCurrent = () => {
    if (coverFocused) {
      if (activeArrays.texts.length + activeArrays.stickers.length === 0) return;
      const next = autoAlignCover(activeArrays.texts, activeArrays.stickers);
      writeSide(activeSide, { texts: next.texts, stickers: next.stickers });
    } else {
      if (!block) return;
      const next = autoAlignBlock(block);
      api.patchBlock(block.key, { texts: next.texts, stickers: next.stickers });
    }
    setMessage({ kind: 'ok', text: 'Aligned the page.' });
  };

  // ── auto-layout ────────────────────────────────────────────────────────────────
  const enginePhotos = photos.filter((p) => p.status === 'ready').map((p): EnginePhoto => ({ id: p.id, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt }));
  const availableEngine = availablePhotos.map((p): EnginePhoto => ({ id: p.id, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt }));
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
    setProposal(null);
    setCurrent(0);
    setMessage({ kind: 'ok', text: 'Layout applied — review it, then Save.' });
  };

  // ── persist ───────────────────────────────────────────────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setMessage(null);
    const res = await saveLayout({ albumId, blocks: api.serialize() });
    setSaving(false);
    if (res.ok) {
      api.setDirty(false);
      setMessage({ kind: 'ok', text: 'Layout saved.' });
      return true;
    }
    setMessage({ kind: 'err', text: res.error });
    return false;
  }, [albumId, api]);

  const saveAndExit = async () => {
    setExiting(true);
    if (api.dirty) {
      const ok = await saveLayout({ albumId, blocks: api.serialize() });
      if (!ok.ok) {
        setExiting(false);
        setMessage({ kind: 'err', text: ok.error });
        return;
      }
      api.setDirty(false);
    }
    router.push('/dashboard');
  };

  // ── Blueprint Mode persistence + exit ──────────────────────────────────────────
  // Save Blueprint = persist the current pages (saveLayout) then distil them into THIS blueprint
  // (updateBlueprintFromAlbum). One click, in-place — the admin keeps editing afterwards.
  const saveBlueprint = useCallback(async (): Promise<boolean> => {
    setBlueprintSaving(true);
    setMessage(null);
    const layout = await saveLayout({ albumId, blocks: api.serialize() });
    if (!layout.ok) {
      setBlueprintSaving(false);
      setMessage({ kind: 'err', text: layout.error });
      return false;
    }
    const res = await updateBlueprintFromAlbum({ albumId });
    setBlueprintSaving(false);
    if (!res.ok) {
      setMessage({ kind: 'err', text: res.error });
      return false;
    }
    api.setDirty(false);
    setLastSaved(Date.now());
    setMessage({ kind: 'ok', text: 'Blueprint saved.' });
    return true;
  }, [albumId, api]);

  // Leaving Blueprint Mode returns to the admin catalog (which restores search/filters/scroll). The
  // draft album is cleaned up server-side; an abandoned never-saved new blueprint is removed too.
  const doExitBlueprint = useCallback(async () => {
    setExitDialogOpen(false);
    await exitBlueprintDraft({ albumId }); // best-effort cleanup
    router.push('/admin/templates');
  }, [albumId, router]);

  const requestExitBlueprint = () => {
    if (api.dirty) setExitDialogOpen(true);
    else void doExitBlueprint();
  };

  // Phase 1 — user clicks Submit: flush pending saves, then run the CENTRAL validation service on
  // the current state. If ANY issue (error or warning) → show the informational dialog. If clean →
  // submit directly. Validation never blocks; it informs (the dialog offers "Continue Anyway").
  const onSubmitClick = async () => {
    setChecking(true);
    setMessage(null);
    // Flush the debounced cover design + layout so validation reads the CURRENT state, not a stale row.
    if (coverSaveTimer.current) clearTimeout(coverSaveTimer.current);
    if (albumTitle.trim()) {
      await saveCoverDesign({ albumId, title: albumTitle, coverTemplateId: coverId, config: coverConfig });
    }
    const saved = await saveLayout({ albumId, blocks: api.serialize() });
    setChecking(false);
    if (!saved.ok) {
      setMessage({ kind: 'err', text: saved.error });
      return;
    }
    api.setDirty(false);
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
      setActiveSide('front');
    } else if (action.type === 'goto-back-cover') {
      setCoverFocused(true);
      setActiveSide('back');
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
      setMessage({
        kind: 'ok',
        text: wasChanges
          ? 'Resubmitted for review. We’ll take another look and get back to you.'
          : 'Album submitted for review! You can still edit it until you place an order.',
      });
    } else {
      setMessage({ kind: 'err', text: res.error });
    }
  };

  // ── zoom ────────────────────────────────────────────────────────────────────────
  const zoomIn = () => setZoomPct((z) => Math.min(200, z + 15));
  const zoomOut = () => setZoomPct((z) => Math.max(50, z - 15));
  const resetZoom = () => setZoomPct(100);

  // ── keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        // ⌘S saves the RIGHT thing per mode: the blueprint (distil) or the customer layout.
        if (api.dirty) void (blueprintMode ? saveBlueprint() : save());
        return;
      }
      if (typing) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === 'g' || e.key === 'G') {
        setShowGuides((v) => !v);
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false);
        setFlipbookOpen(false);
        setEditingPhoto(null);
        setQuickCrop(null);
        setPickedId(null);
        setExitDialogOpen(false);
        setSelection(NO_SELECTION);
      } else if (editLayout === 'focus' && e.key === 'ArrowLeft') {
        setCurrent((c) => Math.max(0, c - 1));
      } else if (editLayout === 'focus' && e.key === 'ArrowRight') {
        setCurrent((c) => Math.min(blocks.length - 1, c + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, save, saveBlueprint, blueprintMode, editLayout, blocks.length]);

  const photoForOverview = (id: string | null | undefined) => {
    const p = id ? photoMap.get(id) : undefined;
    return p ? { url: p.url, edit: p.edit } : undefined;
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[hsl(150_12%_97%)]">
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
        <BuilderHeader email={email} status={status} saving={saving} exiting={exiting} onSaveExit={saveAndExit} />
      )}
      <CanvasToolbar
        title={albumTitle}
        status={status}
        review={review}
        dirty={api.dirty}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onUndo={api.undo}
        onRedo={api.redo}
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
        onPreview={() => setFlipbookOpen(true)}
        onSave={save}
        saving={saving}
        onSubmit={onSubmitClick}
        submitting={submitting}
        albumId={albumId}
        blueprintMode={blueprintMode}
        onSaveBlueprint={saveBlueprint}
        onExitBlueprint={requestExitBlueprint}
        blueprintSaving={blueprintSaving}
      />

      {/* Review banner — customer-only (blueprints are never reviewed/ordered) */}
      {!blueprintMode && review?.status === 'changes_requested' && (
        <div className="flex items-start gap-2.5 border-b border-warning/30 bg-warning/5 px-4 py-2.5 sm:px-6">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 flex-none text-warning" />
          <p className="text-[13px] text-foreground">
            <span className="font-semibold">Changes requested.</span>{' '}
            {review.requestedChanges || 'See the details in your review center.'}{' '}
            <span className="text-muted-foreground">Make the edits, then Resubmit.</span>
          </p>
        </div>
      )}

      {/* 3 columns — one continuous editor (the cover is page 0) */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT — rail + sidebar */}
        <div className="flex flex-none border-r border-border/70 bg-card">
          <nav className="flex w-[68px] flex-col items-center gap-1 border-r border-border/70 py-3" aria-label="Tools">
            {RAIL.filter((t) => (coverFocused ? t.key !== 'layouts' : t.key !== 'templates')).map((t) => {
              const active = railTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setRailTab(t.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-[56px] flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-all duration-200 ease-glide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                    active ? 'bg-studio text-studio-foreground shadow-soft' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <t.Icon className="h-[18px] w-[18px]" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <aside className="flex w-[284px] flex-col overflow-hidden">
            {railTab === 'images' && (
              <>
                <div className="border-b border-border/70 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Photos</h2>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        photos.length >= photoCap(size) ? 'bg-warning/15 text-warning ring-1 ring-warning/25' : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      {photos.length} / {photoCap(size)}
                    </span>
                  </div>
                  <Uploader albumId={albumId} remaining={photoCap(size) - photos.length} onUploaded={onUploaded} ensureWorkerReady={ensureReady} />
                  {/* Live photo indicators — capacity / placed / remaining frames / unused. */}
                  <div className="mt-3 grid grid-cols-2 gap-1.5 text-center">
                    <PhotoStat label="Capacity" value={totalSlots} />
                    <PhotoStat label="Placed" value={placedCount} />
                    <PhotoStat label="Empty frames" value={emptyBaseSlots} tone={emptyBaseSlots > 0 ? 'warning' : 'ok'} />
                    <PhotoStat label="Unused" value={readyUnplaced.length} tone={readyUnplaced.length > 0 ? 'muted' : 'ok'} />
                  </div>
                </div>
                <div className="ms-scroll flex-1 overflow-y-auto p-4">
                  <TrayToolbar
                    search={traySearch}
                    onSearch={setTraySearch}
                    filter={trayFilter}
                    onFilter={setTrayFilter}
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
                  <Tray photos={visiblePhotos} placedIds={placed} pickedId={pickedId} onPick={(id) => setPickedId((c) => (c === id ? null : id))} onEdit={setEditingPhoto} onDeleted={onPhotoDeleted} />
                </div>
              </>
            )}

            {!coverFocused && railTab === 'layouts' && (
              <LayoutsPanel
                hasTarget={!!block}
                canAddTemplate={(t) => canAdd(blocks, size, t)}
                onAddBlock={addBlock}
                onApplyPreset={applyPreset}
              />
            )}

            {/* Cover Templates (Task 2) — cover-only. Applying copies the template's CoverConfig into
                cover_config via the SAME updateCover→saveCoverDesign path; no template link is kept. */}
            {coverFocused && railTab === 'templates' && (
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <h2 className="mb-3 text-[13px] font-semibold tracking-tight text-foreground">Cover templates</h2>
                <CoverTemplatesPanel
                  templates={coverTemplates}
                  stickerUrlFor={stickerUrlFor}
                  hasExistingDesign={isCustomCover(coverConfig)}
                  onApply={(cfg) => {
                    updateCover({ config: cfg });
                    setCoverSel(COVER_NO_SELECTION);
                  }}
                />
              </div>
            )}

            {railTab === 'text' && (
              <TextPanel hasTarget={coverFocused ? true : !!block} onAdd={coverFocused ? addCoverText : addText} />
            )}

            {railTab === 'stickers' && (
              <StickersPanel
                catalog={stickerCatalog}
                hasTarget={coverFocused ? true : !!block}
                onAdd={coverFocused ? addCoverSticker : addPageSticker}
              />
            )}

            {railTab === 'backgrounds' && (
              <BackgroundsPanel
                current={coverFocused ? (activeSide === 'front' ? coverConfig.background : coverConfig.back.background) : block?.background ?? null}
                hasTarget={coverFocused ? true : !!block}
                onApply={(bg) => (coverFocused ? applyCoverBackground(activeSide, bg) : block && api.setBackground(block.key, bg))}
                onApplyAll={(bg) => (coverFocused ? applyCoverBackground(activeSide, bg) : api.setBackgroundAll(bg))}
              />
            )}

            {railTab === 'qr' && (
              <QrPanel hasTarget={coverFocused ? true : !!block} onAdd={coverFocused ? addCoverQr : addQr} />
            )}
          </aside>
        </div>

        {/* CENTER — canvas */}
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
            <CoverCanvas
              title={albumTitle}
              config={coverConfig}
              frontImageUrl={coverImageUrl}
              backImageUrl={backCoverImageUrl}
              size={size}
              zoomPct={zoomPct}
              stickerUrlFor={stickerUrlFor}
              selection={coverSel}
              onSelect={setCoverSel}
              activeSide={activeSide}
              onActiveSide={setActiveSide}
              onChangeText={patchCoverText}
              onReorderText={reorderCoverText}
              onDeleteText={removeCoverText}
              onDuplicateText={duplicateCoverText}
              onChangeSticker={patchCoverSticker}
              onReorderSticker={reorderCoverSticker}
              onDeleteSticker={removeCoverSticker}
              onDuplicateSticker={duplicateCoverSticker}
              onChangeQr={patchCoverQr}
              onReorderQr={reorderCoverQr}
              onDeleteQr={removeCoverQr}
              onDuplicateQr={duplicateCoverQr}
            />
          ) : (
          <div className="ms-scroll relative min-h-0 flex-1 overflow-auto p-6 lg:p-10">
            {blocks.length === 0 ? (
              <EmptyCanvas blueprintMode={blueprintMode} onBuild={() => setBuildMethodOpen(true)} onAdd={() => addBlock('single-pair')} canBuild={enginePhotos.length > 0} />
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
                    className={`group relative overflow-hidden rounded-xl bg-white shadow-[0_2px_4px_rgb(16_24_20/0.06),0_18px_44px_-24px_rgb(16_24_20/0.4)] ring-1 transition-all duration-200 hover:-translate-y-1 ${i === cur ? 'ring-2 ring-studio' : 'ring-black/[0.04] hover:ring-studio-bright/50'}`}
                    style={{ containerType: 'inline-size' }}
                  >
                    <div className="relative w-full" style={{ aspectRatio: pairA }}>
                      <PairContent block={b} photoFor={photoForOverview} stickerUrlFor={stickerUrlFor} />
                      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10" />
                    </div>
                    <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-foreground/55 text-[11px] font-semibold text-white backdrop-blur-sm">{i + 1}</span>
                  </button>
                ))}
              </div>
            ) : (
              block && (
                <div className="mx-auto" style={{ width: `${zoomPct}%`, maxWidth: zoomPct <= 100 ? '1100px' : 'none' }}>
                  <BlockCard
                    api={api}
                    block={block}
                    index={cur}
                    blocks={blocks}
                    photoMap={photoMap}
                    availablePhotos={availablePhotos}
                    selection={selection}
                    onSelect={setSelection}
                    onEditPhoto={openEditor}
                    onQuickCrop={openQuickCrop}
                    stickerUrlFor={stickerUrlFor}
                    pickActive={!!pickedId}
                    onTapPlaceBase={(slot: BaseSlot) => {
                      if (!pickedId) return;
                      api.assignBaseSlot(block.key, slot, pickedId);
                      setPickedId(null);
                    }}
                    showGuides={showGuides}
                  />
                </div>
              )
            )}

            {/* Floating add-page */}
            {blocks.length > 0 && (
              <div className="absolute bottom-5 right-5 z-20">
                {addMenuOpen && (
                  <div className="animate-scale-in absolute bottom-14 right-0 w-52 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-elevated">
                    <AddItem icon={<Square />} label="Blank single page" disabled={!canAddMore} onClick={() => { addBlock('single-pair'); setAddMenuOpen(false); }} />
                    <AddItem icon={<BookOpen />} label="Blank double page" disabled={!canAddMore} onClick={() => { addBlock('double-spread'); setAddMenuOpen(false); }} />
                    <AddItem icon={<Copy />} label="Duplicate this page" disabled={!canAddMore || !block} onClick={() => { if (block) duplicateBlock(block.key); setAddMenuOpen(false); }} />
                    <AddItem icon={<LayoutGrid />} label="Choose a layout…" onClick={() => { setRailTab('layouts'); setAddMenuOpen(false); }} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((v) => !v)}
                  disabled={!canAddMore}
                  aria-label="Add page"
                  className="grid h-12 w-12 place-items-center rounded-full bg-studio text-studio-foreground shadow-[0_4px_12px_-2px_hsl(150_46%_26%/0.5)] transition-all duration-150 ease-glide hover:bg-[hsl(150_48%_29%)] hover:shadow-[0_8px_22px_-4px_hsl(150_46%_24%/0.6)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-2 disabled:opacity-40"
                  title={canAddMore ? 'Add a page' : 'Album is full'}
                >
                  <Plus className={`h-5 w-5 transition-transform duration-200 ${addMenuOpen ? 'rotate-45' : ''}`} />
                </button>
              </div>
            )}

          </div>
          )}

          {/* message toast — over either canvas */}
          {message && (
            <div className={`animate-scale-in pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-xl border px-3.5 py-2 text-[13px] font-medium shadow-elevated ${message.kind === 'ok' ? 'border-studio/25 bg-studio-soft text-studio' : 'border-destructive/20 bg-destructive/5 text-destructive'}`}>
              {message.text}
            </div>
          )}
        </main>

        {/* RIGHT — inspector (cover-aware: cover settings / selected element) */}
        <aside className="flex w-[300px] flex-none flex-col border-l border-border/70 bg-card">
          {coverFocused ? (
            coverSel.kind === 'spine' ? (
              <SpineInspector
                spineTitle={coverConfig.spineTitle}
                spineColor={coverConfig.spineColor}
                fallbackTitle={albumTitle}
                onChange={(patch) => updateCover({ config: patch })}
              />
            ) : coverSelectedText && coverSelSide ? (
              <TextInspector
                el={coverSelectedText}
                onChange={(patch) => patchCoverText(coverSelSide, coverSelectedText.id, patch)}
                onDelete={() => {
                  removeCoverText(coverSelSide, coverSelectedText.id);
                  setCoverSel(COVER_NO_SELECTION);
                }}
              />
            ) : coverSelectedSticker && coverSelSide ? (
              <StickerInspector
                el={coverSelectedSticker}
                onChange={(patch) => patchCoverSticker(coverSelSide, coverSelectedSticker.id, patch)}
                onDelete={() => {
                  removeCoverSticker(coverSelSide, coverSelectedSticker.id);
                  setCoverSel(COVER_NO_SELECTION);
                }}
                onDuplicate={() => duplicateCoverSticker(coverSelSide, coverSelectedSticker.id)}
                onForward={() => reorderCoverSticker(coverSelSide, coverSelectedSticker.id, 1)}
                onBackward={() => reorderCoverSticker(coverSelSide, coverSelectedSticker.id, -1)}
              />
            ) : coverSelectedQr && coverSelSide ? (
              <QrInspector
                el={coverSelectedQr}
                onChange={(patch) => patchCoverQr(coverSelSide, coverSelectedQr.id, patch)}
                onDelete={() => {
                  removeCoverQr(coverSelSide, coverSelectedQr.id);
                  setCoverSel(COVER_NO_SELECTION);
                }}
              />
            ) : (
              <>
                <div className="border-b border-border/70 px-4 py-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cover designer</p>
                  <h2 className="mt-0.5 font-display text-[17px] font-semibold tracking-tight text-foreground">Design your cover</h2>
                </div>
                <CoverPanel
                  title={albumTitle}
                  coverId={coverId}
                  config={coverConfig}
                  covers={covers}
                  photos={photos}
                  photoMap={photoMap}
                  activeSide={activeSide}
                  onActiveSide={setActiveSide}
                  onUpdate={updateCover}
                  onEditImage={setCoverImageEditor}
                  showPreview={false}
                />
              </>
            )
          ) : (
            <Inspector
              api={api}
              block={block}
              index={cur}
              total={blocks.length}
              size={size}
              selection={selection}
              photoMap={photoMap}
              showGuides={showGuides}
              onToggleGuides={() => setShowGuides((v) => !v)}
              onSelect={setSelection}
              onEditPhoto={openEditor}
              onPhotoChange={onPhotoChange}
              onPhotoCommit={onPhotoCommit}
            />
          )}
        </aside>
      </div>

      {/* BOTTOM — timeline (the Cover is page 0, then the content spreads) */}
      <div className="flex flex-none items-center gap-3 border-t border-border/70 bg-card px-4 py-2">
        {/* Cover thumbnail — page 0 (fixed first, not reorderable/deletable) */}
        <button
          type="button"
          onClick={focusCover}
          aria-current={coverFocused ? 'true' : undefined}
          title="Cover — back · spine · front"
          className={`group relative h-[58px] w-[92px] flex-none overflow-hidden rounded-lg bg-white ring-2 transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-studio-bright ${coverFocused ? 'ring-studio shadow-card' : 'ring-border'}`}
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
            current={coverFocused ? -1 : cur}
            canAddMore={canAddMore}
            onJump={focusBlock}
            onReorder={api.reorderBlocks}
            onInsertAfter={insertAfter}
            onDuplicate={duplicateBlock}
            onDelete={api.removeBlock}
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
              className="flex-none gap-2 rounded-lg border-transparent bg-[hsl(150_48%_29%)] px-4 font-semibold text-studio-foreground shadow-[0_1px_2px_rgb(16_24_20/0.14),0_8px_20px_-8px_hsl(150_46%_22%/0.55)] transition-all duration-200 ease-glide hover:-translate-y-px hover:bg-[hsl(150_50%_25%)] hover:shadow-[0_3px_10px_rgb(16_24_20/0.18),0_16px_30px_-10px_hsl(150_46%_20%/0.6)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-2"
            >
              <Eye /> Preview
            </Button>
          </>
        )}
      </div>

      {/* Modals */}
      {editingPhoto && (
        <PhotoEditor
          photoId={editingPhoto.id}
          url={editingPhoto.url}
          filename={editingPhoto.filename}
          initial={editingPhoto.edit}
          frameAspect={editPlacement.aspect}
          showGutter={editPlacement.gutter}
          onClose={() => setEditingPhoto(null)}
          onSaved={(edit) => onPhotoSaved(editingPhoto.id, edit)}
        />
      )}
      {coverImageEditor &&
        (() => {
          const side = coverImageEditor;
          const photoId = side === 'front' ? coverConfig.photoId : coverConfig.back.photoId;
          const photo = photoId ? photoMap.get(photoId) : undefined;
          if (!photo) return null;
          const initial = side === 'front' ? coverConfig.imageEdit : coverConfig.back.imageEdit;
          return (
            <PhotoEditor
              photoId={photo.id}
              url={photo.url}
              filename={photo.filename}
              initial={initial}
              frameAspect={pageA}
              showGutter={false}
              onClose={() => setCoverImageEditor(null)}
              onSaved={(edit) =>
                side === 'front'
                  ? updateCover({ config: { imageEdit: edit } })
                  : updateCover({ config: { back: { ...coverConfig.back, imageEdit: edit } } })
              }
            />
          );
        })()}
      {quickCrop && (
        <QuickCrop
          photoId={quickCrop.photo.id}
          url={quickCrop.photo.url}
          filename={quickCrop.photo.filename}
          initial={quickCrop.photo.edit}
          frameAspect={quickCrop.aspect}
          showGutter={quickCrop.gutter}
          onClose={() => setQuickCrop(null)}
          onSaved={(edit) => onPhotoSaved(quickCrop.photo.id, edit)}
        />
      )}
      {flipbookOpen && (
        <Flipbook
          blocks={blocks}
          photoMap={photoMap}
          stickerUrlFor={stickerUrlFor}
          cover={{ imageUrl: coverImageUrl, backImageUrl: backCoverImageUrl, config: coverConfig, title: albumTitle, name: selectedCover?.name ?? albumTitle, size }}
          onClose={() => setFlipbookOpen(false)}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

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
      {/* "Build it for me" — the SAME Auto Create / Choose Blueprint / Custom workflow as the wizard. */}
      {buildMethodOpen && (
        <BuildMethod
          albumSize={size}
          uploaded={enginePhotos.length}
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
          cover={selectedCover}
          summary={proposal.summary}
          canRegenerate={proposal.kind === 'build' || proposal.kind === 'suggest'}
          onAccept={acceptProposal}
          onRegenerate={() => generate(proposal.kind, proposal.strategy + 1)}
          onCancel={() => setProposal(null)}
        />
      )}
      {workerModal}
    </div>
  );
}

/** Compact photo-placement stat tile (builder Images panel). */
function PhotoStat({ label, value, tone = 'ok' }: { label: string; value: number; tone?: 'ok' | 'warning' | 'muted' }) {
  const toneCls =
    tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-card px-1.5 py-2">
      <div className={`text-base font-semibold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function EmptyCanvas({ blueprintMode, onBuild, onAdd, canBuild }: { blueprintMode?: boolean; onBuild: () => void; onAdd: () => void; canBuild: boolean }) {
  return (
    <div className="mx-auto mt-6 max-w-md animate-scale-in rounded-2xl border border-dashed border-border bg-card/70 p-12 text-center">
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
          <p className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">Start your story</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
            Add a single page (a photo on each side) or a double page (one image across the fold) — or let us arrange your photos.
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

function AddItem({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-studio"
    >
      {icon}
      {label}
    </button>
  );
}
