'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Save,
  Send,
  Loader2,
  CheckCircle2,
  LayoutGrid,
  Eye,
  ShoppingCart,
  BookImage,
  X,
  Undo2,
  Redo2,
  Keyboard,
  Frame,
  Rows3,
  Square,
  ChevronLeft,
  ChevronRight,
  Hand,
  Layers,
  ArrowUp,
  ArrowDown,
  Trash2,
  Wand2,
  MessageSquareWarning,
  LayoutTemplate as LayoutTemplateIcon,
} from 'lucide-react';
import Uploader, { type Photo } from './_uploader';
import Tray from './_tray';
import TrayToolbar, { type TrayFilter } from './_tray-toolbar';
import BlockCard, { type BaseSlot } from './_block';
import Navigator from './_navigator';
import ShortcutsOverlay from './_shortcuts';
import Assistant, { type AssistKind } from './_assistant';
import Proposal from './_proposal';
import LayoutPanel from './_layout-panel';
import { type ActiveTemplate } from '@/lib/templates/catalog';
import { type TemplateGeometry } from '@/lib/templates/model';
import Preview from './_preview';
import PhotoEditor from './_photo-editor';
import QuickCrop from './_quick-crop';
import { useHistoryState } from './_history';
import {
  autoLayout,
  regenerate,
  fillEmptyFrames,
  orderByDate,
  summarizePlan,
  type EnginePhoto,
} from '@/lib/builder/auto-layout';
import {
  LAYOUT_TEMPLATES,
  DEFAULT_OVERLAY_GEOM,
  TEMPLATE_LABEL,
  photoCap,
  pagesConsumed,
  canAdd,
  isAlbumComplete,
  placedPhotoIds,
  requiredBaseCount,
  type Block,
  type LayoutTemplate,
  type Overlay,
  type EditConfig,
} from '@/lib/builder/model';
import { saveLayout, submitAlbum, selectCover } from '@/lib/actions/builder';
import { Button } from '@/components/ui/button';
import { type CoverOption } from '@/lib/covers';
import { useWorkerGate } from '@/components/worker/use-worker-gate';
import { LUX_PRIMARY, CompletionSeal, Sprig } from '@/components/brand';
import { reviewStatusLabel, reviewStatusChip } from '@/lib/reviews/model';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
// "Add" button labels keyed to the user's vocabulary.
const ADD_LABEL: Record<LayoutTemplate, string> = {
  'single-pair': 'Add Single Page',
  'double-spread': 'Add Double Page',
};

export default function Builder({
  albumId,
  title,
  size,
  initialStatus,
  initialPhotos,
  initialBlocks,
  covers,
  initialCoverId,
  initialReview,
  layoutTemplates = [],
}: {
  albumId: string;
  title: string;
  size: number;
  initialStatus: string;
  initialPhotos: Photo[];
  initialBlocks: Block[];
  covers: CoverOption[];
  initialCoverId: string | null;
  initialReview: { status: string; requestedChanges: string | null } | null;
  layoutTemplates?: ActiveTemplate[];
}) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  // History-backed layout state (client-only undo/redo). `blocks` is the present value;
  // every change still persists through the existing saveLayout — no new persistence.
  const blocksHist = useHistoryState<Block[]>(initialBlocks);
  const blocks = blocksHist.value;
  const [status, setStatus] = useState(initialStatus);
  // Phase 9C — advisory album review (parallel to checkout; never gates editing). After a
  // (re)submit the album re-enters 'pending_review'; we reflect that optimistically.
  const [review, setReview] = useState(initialReview);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [editLayout, setEditLayout] = useState<'focus' | 'all'>('focus');
  const [current, setCurrent] = useState(0); // focused spread index
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [quickCrop, setQuickCrop] = useState<{ photo: Photo; aspect: number; gutter: boolean } | null>(null);
  const [coverId, setCoverId] = useState<string | null>(initialCoverId);
  const [coverPicker, setCoverPicker] = useState(false);

  // P0/P1 interaction state (all client-only).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [traySearch, setTraySearch] = useState('');
  const [trayFilter, setTrayFilter] = useState<TrayFilter>('all');
  const [showGuides, setShowGuides] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [removingUnused, setRemovingUnused] = useState(false);

  // Layout assistant (deterministic; propose → preview → apply).
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Layout templates panel (Phase 9E) — applies a curated preset to the focused spread.
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const [proposal, setProposal] = useState<{
    kind: AssistKind;
    strategy: number;
    blocks: Block[];
    title: string;
    summary: ReturnType<typeof summarizePlan>;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Dirty-state: true after ANY content change; cleared ONLY by a successful save.
  const [dirty, setDirty] = useState(false);

  // Worker readiness gate — uploads require the (sleepable) worker for image hardening.
  // `ensureReady` wakes it (with a modal) before an upload begins. PDF generation is now
  // a BACKEND workflow (auto-run after payment / admin-triggered), not a customer action.
  const { ensureReady, modal: workerModal } = useWorkerGate();

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const placed = useMemo(() => placedPhotoIds(blocks), [blocks]);
  const availablePhotos = useMemo(
    () => photos.filter((p) => p.status === 'ready' && !placed.has(p.id)),
    [photos, placed],
  );
  const selectedCover = useMemo(() => covers.find((c) => c.id === coverId) ?? null, [covers, coverId]);

  // The fixed crop frame for the editing photo matches WHERE it is placed, so the
  // editor crops against the exact printable area (WYSIWYG with the slot + PDF):
  //   single-page base → 3:4 portrait page · double-spread base → 3:2 open pair
  //   overlay → its rect's aspect within the 3:2 pair box · unplaced → default 3:4.
  const editPlacement = useMemo(() => {
    const fallback = { aspect: 3 / 4, gutter: false };
    if (!editingPhoto) return fallback;
    for (const b of blocks) {
      if (b.photoIds[0] === editingPhoto.id || b.photoIds[1] === editingPhoto.id) {
        return b.template === 'double-spread' ? { aspect: 3 / 2, gutter: true } : { aspect: 3 / 4, gutter: false };
      }
      const ov = b.overlays.find((o) => o.photoId === editingPhoto.id);
      if (ov && ov.h > 0) return { aspect: (ov.w * 3) / (ov.h * 2), gutter: false };
    }
    return fallback;
  }, [editingPhoto, blocks]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Poll processing photos (does NOT mark dirty — not a user change).
  const hasPending = photos.some((p) => p.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/photos?albumId=${albumId}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          photos: {
            id: string;
            status: Photo['status'];
            url: string;
            thumbUrl: string;
            takenAt: string | null;
            width?: number | null;
            height?: number | null;
          }[];
        };
        if (!active) return;
        setPhotos((prev) =>
          prev.map((p) => {
            const u = body.photos.find((x) => x.id === p.id);
            return u
              ? { ...p, status: u.status, url: u.url, thumbUrl: u.thumbUrl, takenAt: u.takenAt, width: u.width ?? null, height: u.height ?? null }
              : p;
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

  const consumed = pagesConsumed(blocks);
  const remaining = size - consumed;
  const complete = isAlbumComplete(blocks, size) && !!coverId;

  // Focused-spread index, clamped to the current block count.
  const cur = Math.min(current, Math.max(0, blocks.length - 1));

  // Tray search + filter (client-only). `readyUnplaced` powers "Remove unused".
  const readyUnplaced = photos.filter((p) => p.status === 'ready' && !placed.has(p.id));
  const trayQuery = traySearch.trim().toLowerCase();
  const visiblePhotos = photos.filter((p) => {
    if (trayQuery && !p.filename.toLowerCase().includes(trayQuery)) return false;
    if (trayFilter === 'unplaced') return p.status === 'ready' && !placed.has(p.id);
    if (trayFilter === 'placed') return placed.has(p.id);
    if (trayFilter === 'processing') return p.status === 'pending';
    return true;
  });

  // ── Layout assistant (deterministic engine; propose only) ─────────────────────
  const toEngine = (p: Photo): EnginePhoto => ({ id: p.id, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt });
  const enginePhotos = photos.filter((p) => p.status === 'ready').map(toEngine);
  const availableEngine = availablePhotos.map(toEngine);

  // Active layout presets as engine choices (overlay-slot geometry the auto-layout MAY use).
  // Empty → the engine behaves exactly as before. Pure mapping; no renderer coupling.
  const templateChoices = useMemo(
    () => layoutTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays })),
    [layoutTemplates],
  );

  const generate = (kind: AssistKind, strategy = 0) => {
    let proposed: Block[];
    let title: string;
    switch (kind) {
      case 'build':
        proposed = autoLayout(enginePhotos, size, strategy, templateChoices);
        title = 'Build my album';
        break;
      case 'suggest':
        proposed = regenerate(enginePhotos, size, strategy, templateChoices);
        title = 'Suggested structure';
        break;
      case 'fill':
        proposed = fillEmptyFrames(blocks, availableEngine);
        title = 'Fill empty frames';
        break;
      case 'date':
        proposed = orderByDate(blocks, enginePhotos);
        title = 'Organize by date';
        break;
    }
    setProposal({ kind, strategy, blocks: proposed, title, summary: summarizePlan(proposed, enginePhotos.length) });
    setAssistantOpen(false);
  };

  const acceptProposal = () => {
    if (!proposal) return;
    const applied = proposal.blocks;
    mutateBlocks(() => applied);
    setProposal(null);
    setCurrent(0);
    setMessage({ kind: 'ok', text: 'Layout applied — review it, then Save.' });
  };

  // ── dirty-aware block mutation (history-recorded) ─────────────────────────────
  const mutateBlocks = (updater: (prev: Block[]) => Block[]) => {
    blocksHist.set(updater);
    setDirty(true);
  };

  const onUndo = useCallback(() => {
    blocksHist.undo();
    setDirty(true);
  }, [blocksHist]);
  const onRedo = useCallback(() => {
    blocksHist.redo();
    setDirty(true);
  }, [blocksHist]);

  // Reorder spreads (navigator drag). Reordering never changes which photo sits in
  // which slot, so the placed-once rule is preserved.
  const reorderBlocks = (from: number, to: number) =>
    mutateBlocks((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });

  // ── photos ──────────────────────────────────────────────────────────────────
  const onUploaded = (photo: Photo) => {
    setPhotos((prev) => [...prev, photo]);
    setDirty(true);
  };

  const stripPhoto = (list: Block[], id: string): Block[] =>
    list.map((b) => {
      const inBase = b.photoIds.includes(id);
      const overlays = b.overlays.filter((o) => o.photoId !== id);
      if (!inBase && overlays.length === b.overlays.length) return b;
      return { ...b, photoIds: b.photoIds.filter((pid) => pid !== id), overlays };
    });

  const onPhotoDeleted = (id: string) => {
    mutateBlocks((prev) => stripPhoto(prev, id));
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // "Remove unused": delete every ready + unplaced photo via the EXISTING
  // DELETE /api/photos/:id (the same endpoint the tray uses). No new endpoint/persistence.
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
        /* skip; user can retry */
      }
    }
    setRemovingUnused(false);
  };

  const onPhotoSaved = (photoId: string, edit: EditConfig) => {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, edit } : p)));
    setDirty(true); // crop/zoom/rotate change → album state changed
  };

  // Quick-crop (pan/zoom) opened from a page block's photo.
  const openQuickCrop = (photoId: string, aspect: number, gutter: boolean) => {
    const p = photoMap.get(photoId);
    if (p) setQuickCrop({ photo: p, aspect, gutter });
  };

  // ── blocks ──────────────────────────────────────────────────────────────────
  const addBlock = (template: LayoutTemplate) => {
    if (!canAdd(blocks, size, template)) return;
    mutateBlocks((prev) => [...prev, { key: crypto.randomUUID(), template, photoIds: [], caption: '', overlays: [] }]);
  };

  const patchBlock = (key: string, patch: Partial<Block>) =>
    mutateBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const removeBlock = (key: string) => mutateBlocks((prev) => prev.filter((b) => b.key !== key));

  /**
   * Apply a layout PRESET to one block (Phase 9E). Produces an ordinary Block — sets the
   * base primitive, keeps base photos that still fit, and fills the preset's overlay slots
   * from (existing overlay photos → photos dropped from base → available tray photos).
   * Photos that don't fit simply return to the tray (unplaced) — never deleted, never lost.
   * Persists through the existing Save; no new save path, no renderer change.
   */
  const applyTemplateToBlock = (key: string, geometry: TemplateGeometry) => {
    const block = blocks.find((b) => b.key === key);
    if (!block) return;
    const base = geometry.base;
    const need = requiredBaseCount(base);
    const baseFilled = block.photoIds.filter(Boolean);
    const keptBase = baseFilled.slice(0, need);
    const droppedBase = baseFilled.slice(need);

    // Ordered, de-duplicated pool of photos available to fill the preset's overlay slots.
    const seen = new Set<string>(keptBase);
    const pool = [
      ...block.overlays.map((o) => o.photoId),
      ...droppedBase,
      ...availablePhotos.map((p) => p.id),
    ].filter((id) => id && !seen.has(id) && (seen.add(id), true));

    const newOverlays: Overlay[] = geometry.overlays
      .slice(0, pool.length)
      .map((slot, i) => ({ photoId: pool[i], x: slot.x, y: slot.y, w: slot.w, h: slot.h }));

    patchBlock(key, { template: base, photoIds: keptBase, overlays: newOverlays });
    setLayoutPanelOpen(false);
    setMessage({ kind: 'ok', text: 'Layout applied to this spread — review it, then Save.' });
  };

  const moveBlock = (key: string, dir: -1 | 1) =>
    mutateBlocks((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Slot-aware base assignment. single-pair keeps a left-first prefix invariant: a photo
  // dropped on the right while the left is empty lands on the left; clearing the left
  // promotes the right. double-spread uses a single 'image' slot at index 0.
  const assignBaseSlot = (key: string, slot: BaseSlot, photoId: string) =>
    mutateBlocks((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        if (slot === 'image') return { ...b, photoIds: [photoId] };
        const ids = [...b.photoIds];
        let idx = slot === 'left' ? 0 : 1;
        if (idx === 1 && !ids[0]) idx = 0; // no left → fill left first
        ids[idx] = photoId;
        return { ...b, photoIds: ids.slice(0, 2) };
      }),
    );

  const clearBaseSlot = (key: string, slot: BaseSlot) =>
    mutateBlocks((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        if (slot === 'image' || slot === 'left') return { ...b, photoIds: b.photoIds.slice(1) }; // promote right→left
        return { ...b, photoIds: b.photoIds.slice(0, 1) }; // drop right
      }),
    );

  const addOverlay = (key: string, photoId: string) =>
    mutateBlocks((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        const n = b.overlays.length;
        const w = DEFAULT_OVERLAY_GEOM.w;
        const h = DEFAULT_OVERLAY_GEOM.h;
        const overlay: Overlay = {
          photoId,
          x: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.x + (n % 5) * 0.04, 1 - w)),
          y: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.y + (n % 5) * 0.04, 1 - h)),
          w,
          h,
        };
        return { ...b, overlays: [...b.overlays, overlay] };
      }),
    );

  const replaceOverlay = (key: string, index: number, photoId: string) =>
    mutateBlocks((prev) =>
      stripPhoto(prev, photoId).map((b) =>
        b.key === key ? { ...b, overlays: b.overlays.map((o, i) => (i === index ? { ...o, photoId } : o)) } : b,
      ),
    );

  const patchOverlays = (key: string, overlays: Overlay[]) =>
    mutateBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, overlays } : b)));

  // ── cover ─────────────────────────────────────────────────────────────────────
  const chooseCover = async (id: string) => {
    setCoverPicker(false);
    const prev = coverId;
    setCoverId(id);
    setDirty(true);
    const res = await selectCover({ albumId, coverTemplateId: id });
    if (!res.ok) {
      setCoverId(prev);
      setMessage({ kind: 'err', text: res.error });
    }
  };

  // ── persist ─────────────────────────────────────────────────────────────────
  const serialize = useCallback(
    () =>
      blocks.map((b) => ({
        template: b.template,
        photoIds: b.photoIds.filter(Boolean),
        caption: b.caption,
        overlays: b.overlays,
      })),
    [blocks],
  );

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setMessage(null);
    const res = await saveLayout({ albumId, blocks: serialize() });
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      setMessage({ kind: 'ok', text: 'Layout saved.' });
      return true;
    }
    setMessage({ kind: 'err', text: res.error });
    return false;
  }, [albumId, serialize]);

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    const saved = await saveLayout({ albumId, blocks: serialize() });
    if (!saved.ok) {
      setSubmitting(false);
      setMessage({ kind: 'err', text: saved.error });
      return;
    }
    setDirty(false);
    const wasChanges = review?.status === 'changes_requested';
    const res = await submitAlbum(albumId);
    setSubmitting(false);
    if (res.ok) {
      setStatus('submitted');
      // The album (re)enters review as pending; clear any prior requested-changes banner.
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

  const pct = Math.min(100, size ? (consumed / size) * 100 : 0);

  // One BlockCard, reused by both the focus (one spread) and all-spreads layouts.
  const renderBlockCard = (block: Block, i: number) => (
    <BlockCard
      block={block}
      index={i}
      blocks={blocks}
      photoMap={photoMap}
      availablePhotos={availablePhotos}
      isFirst={i === 0}
      isLast={i === blocks.length - 1}
      onPatch={(patch) => patchBlock(block.key, patch)}
      onAssignBase={(slot, photoId) => assignBaseSlot(block.key, slot, photoId)}
      onClearBase={(slot) => clearBaseSlot(block.key, slot)}
      onQuickCrop={openQuickCrop}
      onEditPhoto={(photoId) => {
        const p = photoMap.get(photoId);
        if (p) setEditingPhoto(p);
      }}
      onAddOverlay={(photoId) => addOverlay(block.key, photoId)}
      onReplaceOverlay={(index, photoId) => replaceOverlay(block.key, index, photoId)}
      onPatchOverlays={(overlays) => patchOverlays(block.key, overlays)}
      onRemove={() => removeBlock(block.key)}
      onMove={(dir) => moveBlock(block.key, dir)}
      pickActive={!!pickedId}
      onTapPlaceBase={(slot) => {
        if (!pickedId) return;
        assignBaseSlot(block.key, slot, pickedId);
        setPickedId(null);
      }}
      showGuides={showGuides}
    />
  );

  // ── Keyboard shortcuts (client-only) ──────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (dirty) void save();
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
        setEditingPhoto(null);
        setQuickCrop(null);
        setCoverPicker(false);
        setPickedId(null);
        setLayoutPanelOpen(false);
      } else if (view === 'edit' && editLayout === 'focus' && e.key === 'ArrowLeft') {
        setCurrent((c) => Math.max(0, c - 1));
      } else if (view === 'edit' && editLayout === 'focus' && e.key === 'ArrowRight') {
        setCurrent((c) => Math.min(blocks.length - 1, c + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo, save, dirty, view, editLayout, blocks.length]);

  return (
    <div className="space-y-5">
      {/* ── Top bar: identity + primary actions ─────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link href="/dashboard" className="transition-colors hover:text-foreground">
              Dashboard
            </Link>
            <span className="text-border">/</span>
            <span className="truncate text-foreground/70">{title}</span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[1.9rem] font-semibold leading-none tracking-[-0.01em] text-foreground">{title}</h1>
            {status === 'submitted' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success ring-1 ring-success/20">
                <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
              </span>
            )}
            {review && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${reviewStatusChip(review.status)}`}>
                {reviewStatusLabel(review.status)}
              </span>
            )}
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/20">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" /> Unsaved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border/60">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Saved
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* History + canvas tools */}
          <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs">
            <Button variant="ghost" size="icon-sm" onClick={onUndo} disabled={!blocksHist.canUndo} aria-label="Undo" title="Undo (⌘Z)">
              <Undo2 />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onRedo} disabled={!blocksHist.canRedo} aria-label="Redo" title="Redo (⌘⇧Z)">
              <Redo2 />
            </Button>
            <span className="mx-0.5 my-1 w-px bg-border" />
            <Button
              variant={showGuides ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setShowGuides((v) => !v)}
              aria-label="Toggle guides"
              title="Margins & safe zone (G)"
            >
              <Frame />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title="Shortcuts (?)">
              <Keyboard />
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => setAssistantOpen(true)} title="Layout assistant">
            <Wand2 /> Assistant
          </Button>

          {layoutTemplates.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setLayoutPanelOpen(true)} title="Apply a layout to this spread">
              <LayoutTemplateIcon /> Layouts
            </Button>
          )}

          <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs">
            <Button variant={view === 'edit' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('edit')}>
              <LayoutGrid /> Edit
            </Button>
            <Button variant={view === 'preview' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('preview')}>
              <Eye /> Preview
            </Button>
          </div>

          {view === 'edit' && (
            <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs">
              <Button variant={editLayout === 'focus' ? 'secondary' : 'ghost'} size="icon-sm" onClick={() => setEditLayout('focus')} aria-label="One spread at a time" title="One spread at a time">
                <Square />
              </Button>
              <Button variant={editLayout === 'all' ? 'secondary' : 'ghost'} size="icon-sm" onClick={() => setEditLayout('all')} aria-label="All spreads" title="All spreads">
                <Rows3 />
              </Button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={save} disabled={saving || submitting || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          <Button size="sm" onClick={submit} disabled={!complete || saving || submitting} className={LUX_PRIMARY}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />}{' '}
            {review?.status === 'changes_requested' ? 'Resubmit for Review' : 'Submit'}
          </Button>

          {status === 'submitted' && (
            <Button size="sm" render={<Link href={`/checkout/${albumId}`} />} className={LUX_PRIMARY}>
              <ShoppingCart /> Checkout
            </Button>
          )}
        </div>
      </div>

      {/* ── Review: requested changes banner (advisory; never blocks editing) ── */}
      {review?.status === 'changes_requested' && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-start sm:gap-3">
          <MessageSquareWarning className="h-5 w-5 flex-none text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Our team requested a few changes</p>
            {review.requestedChanges ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {review.requestedChanges}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                See the details in your{' '}
                <Link href="/reviews" className="font-medium text-primary hover:underline">
                  review center
                </Link>
                .
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Make the edits, then use <span className="font-medium text-foreground">Resubmit for Review</span> above.
            </p>
          </div>
        </div>
      )}

      {/* ── Album progress: page budget meter + cover chip ──────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-card/90 p-4 shadow-panel backdrop-blur-sm">
        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-display text-[1.9rem] font-semibold leading-none tabular-nums tracking-[-0.01em] transition-colors duration-300 ${
              remaining < 0 ? 'text-destructive' : remaining === 0 ? 'text-success' : 'text-foreground'
            }`}
          >
            {consumed}
          </span>
          <span className="font-display text-base text-muted-foreground/60">/</span>
          <span className="font-display text-base text-muted-foreground">{size}</span>
          <span className="ml-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">pages</span>
        </div>

        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                remaining < 0
                  ? 'bg-destructive'
                  : pct >= 100
                    ? 'bg-gradient-to-r from-success to-success'
                    : 'bg-gradient-to-r from-primary/70 to-primary'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs">
            <span className={remaining < 0 ? 'font-semibold text-destructive' : 'font-medium text-foreground'}>
              {remaining >= 0 ? `${remaining} page${remaining === 1 ? '' : 's'} remaining` : `${-remaining} over the limit`}
            </span>
            <span className="hidden text-muted-foreground sm:inline"> · cover &amp; blanks added automatically</span>
          </p>
        </div>

        {complete && (
          <div className="ml-auto">
            <CompletionSeal />
          </div>
        )}

        <button
          type="button"
          onClick={() => setCoverPicker(true)}
          className={`group inline-flex items-center gap-2.5 rounded-xl border bg-background py-1.5 pl-1.5 pr-3 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:shadow-card hover:ring-1 hover:ring-primary/30 ${complete ? '' : 'ml-auto'}`}
        >
          <span className="relative block h-11 w-9 overflow-hidden rounded-md bg-muted ring-1 ring-border">
            {selectedCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedCover.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground/60">
                <BookImage className="h-4 w-4" />
              </span>
            )}
          </span>
          <span className="flex flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Cover</span>
            <span className="max-w-[9rem] truncate font-display text-sm font-semibold tracking-tight">
              {selectedCover ? selectedCover.name : 'Choose a design'}
            </span>
          </span>
        </button>
      </div>

      {message && (
        <p
          className={`animate-scale-in rounded-xl border px-3.5 py-2.5 text-sm font-medium ${
            message.kind === 'ok'
              ? 'border-success/20 bg-success/5 text-success'
              : 'border-destructive/20 bg-destructive/5 text-destructive'
          }`}
        >
          {message.text}
        </p>
      )}

      {view === 'preview' ? (
        <Preview blocks={blocks} photoMap={photoMap} cover={selectedCover} />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[336px_1fr]">
          {/* Floating photo library — sticky, frosted, independently scrollable. The
              upload zone stays pinned; the thumbnail grid scrolls within the panel. */}
          <aside className="builder-panel lg:sticky lg:top-5 lg:flex lg:max-h-[calc(100vh-2.5rem)] lg:flex-col overflow-hidden rounded-2xl border border-border/70 shadow-panel">
            <div className="p-4 lg:shrink-0">
              <div className="mb-3 flex items-center gap-2">
                <Sprig className="h-4 w-4 text-primary" />
                <h2 className="font-display text-[15px] font-semibold tracking-tight">Photo Library</h2>
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                    photos.length >= photoCap(size)
                      ? 'bg-warning/15 text-warning ring-1 ring-warning/25'
                      : 'bg-secondary text-secondary-foreground'
                  }`}
                  title={`${photos.length} of ${photoCap(size)} photos used`}
                >
                  {photos.length} / {photoCap(size)}
                </span>
              </div>
              <Uploader
                albumId={albumId}
                remaining={photoCap(size) - photos.length}
                onUploaded={onUploaded}
                ensureWorkerReady={ensureReady}
              />
              <div className="seam mt-4" />
            </div>
            <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
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
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/[0.08] px-3 py-2 text-xs text-foreground">
                  <Hand className="h-3.5 w-3.5 shrink-0 text-gold" />
                  <span className="flex-1">Photo picked up — tap an empty frame to place it.</span>
                  <button type="button" onClick={() => setPickedId(null)} className="font-medium text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}
              <Tray
                photos={visiblePhotos}
                placedIds={placed}
                pickedId={pickedId}
                onPick={(id) => setPickedId((c) => (c === id ? null : id))}
                onEdit={setEditingPhoto}
                onDeleted={onPhotoDeleted}
              />
            </div>
          </aside>

          {/* Dark editing stage — album spreads float here as paper pages. */}
          <main className="relative overflow-hidden rounded-3xl builder-stage p-5 shadow-elevated ring-1 ring-black/40 sm:p-6">
            <div className="stage-grain pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">Add pages</span>
                {LAYOUT_TEMPLATES.map((t) => {
                  const disabled = !canAdd(blocks, size, t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => addBlock(t)}
                      disabled={disabled}
                      className="builder-glass group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/90 shadow-sm transition-all duration-200 ease-glide hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-primary-foreground transition-transform duration-200 ease-glide group-hover:scale-110">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                      {ADD_LABEL[t]}
                      <span className="text-[11px] text-white/40">2 pages</span>
                    </button>
                  );
                })}
              </div>

              {blocks.length === 0 ? (
                <div className="animate-scale-in rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-16 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white/70 ring-1 ring-white/15">
                    <LayoutGrid className="h-6 w-6" />
                  </div>
                  <p className="mt-4 font-display text-xl font-semibold tracking-tight text-white">Start your story</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/55">
                    Add a <span className="font-medium text-white/80">Single Page</span> (two photos) or a{' '}
                    <span className="font-medium text-white/80">Double Page</span> (one image across both) — or let me
                    arrange your photos for you.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                    <Button size="sm" onClick={() => generate('build', 0)} disabled={enginePhotos.length === 0} className={LUX_PRIMARY}>
                      <Wand2 /> Build it for me
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => addBlock('single-pair')}>
                      <Plus /> Start manually
                    </Button>
                  </div>
                </div>
              ) : editLayout === 'focus' ? (
                <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-white/55">
                        Spread {cur + 1} / {blocks.length}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCurrent((c) => Math.max(0, Math.min(c, blocks.length - 1) - 1))}
                          disabled={cur <= 0}
                          aria-label="Previous spread"
                          className="grid h-8 w-8 place-items-center rounded-lg builder-glass text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCurrent((c) => Math.min(blocks.length - 1, Math.min(c, blocks.length - 1) + 1))}
                          disabled={cur >= blocks.length - 1}
                          aria-label="Next spread"
                          className="grid h-8 w-8 place-items-center rounded-lg builder-glass text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div key={blocks[cur].key} className="animate-rise">
                      {renderBlockCard(blocks[cur], cur)}
                    </div>
                  </div>
                  <SpreadInspector
                    block={blocks[cur]}
                    index={cur}
                    total={blocks.length}
                    showGuides={showGuides}
                    onToggleGuides={() => setShowGuides((v) => !v)}
                    onMove={(dir) => moveBlock(blocks[cur].key, dir)}
                    onRemove={() => removeBlock(blocks[cur].key)}
                  />
                </div>
              ) : (
                <div className="grid gap-7">
                  {blocks.map((block, i) => (
                    <div key={block.key} className="animate-rise" style={{ animationDelay: `${Math.min(i * 55, 330)}ms` }}>
                      {renderBlockCard(block, i)}
                    </div>
                  ))}
                </div>
              )}

              {blocks.length > 0 && (
                <Navigator
                  blocks={blocks}
                  photoMap={photoMap}
                  current={cur}
                  onJump={(i) => setCurrent(i)}
                  onReorder={reorderBlocks}
                  onPrev={() => setCurrent((c) => Math.max(0, Math.min(c, blocks.length - 1) - 1))}
                  onNext={() => setCurrent((c) => Math.min(blocks.length - 1, Math.min(c, blocks.length - 1) + 1))}
                />
              )}
            </div>
          </main>
        </div>
      )}

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

      {coverPicker && (
        <CoverPicker covers={covers} selectedId={coverId} onPick={chooseCover} onClose={() => setCoverPicker(false)} />
      )}

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      {assistantOpen && (
        <Assistant
          onAction={(kind) => generate(kind, 0)}
          onClose={() => setAssistantOpen(false)}
          photoCount={enginePhotos.length}
          availableCount={availableEngine.length}
          hasLayout={blocks.length > 0}
        />
      )}

      {layoutPanelOpen && (
        <LayoutPanel
          templates={layoutTemplates}
          hasTarget={blocks.length > 0}
          onApply={(geometry) => {
            const target = blocks[current] ?? blocks[0];
            if (target) applyTemplateToBlock(target.key, geometry);
          }}
          onClose={() => setLayoutPanelOpen(false)}
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

function CoverPicker({
  covers,
  selectedId,
  onPick,
  onClose,
}: {
  covers: CoverOption[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-rise w-full max-w-2xl rounded-2xl border bg-background p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprig className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">Choose a cover design</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="seam mt-3" />
        {covers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No cover designs are available yet. Please check back soon.
          </p>
        ) : (
          <div className="mt-4 grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {covers.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}
                className={`group animate-scale-in overflow-hidden rounded-xl border bg-muted text-left shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card ${
                  selectedId === c.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:ring-1 hover:ring-primary/40'
                }`}
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.thumbUrl}
                    alt={c.name}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  {selectedId === c.id && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  )}
                </div>
                <span className="block truncate px-2.5 py-2 font-display text-[13px] font-medium tracking-tight">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Persistent right contextual panel (focus mode). Shows the current spread's context +
 * the spread-level actions that already exist (move/delete) and the guides toggle.
 * Photo editing stays on the page (hover controls + the editor/quick-crop modals), so
 * no save behaviour changes.
 */
function SpreadInspector({
  block,
  index,
  total,
  showGuides,
  onToggleGuides,
  onMove,
  onRemove,
}: {
  block: Block;
  index: number;
  total: number;
  showGuides: boolean;
  onToggleGuides: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <aside className="builder-glass flex h-fit flex-col gap-4 rounded-2xl p-4 text-white">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Spread</p>
        <p className="mt-1 font-display text-2xl font-semibold tracking-tight">
          {index + 1} <span className="text-base text-white/40">/ {total}</span>
        </p>
        <p className="mt-1 text-sm text-white/70">{TEMPLATE_LABEL[block.template]}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/45">
          <Layers className="h-3.5 w-3.5" /> {block.overlays.length} overlay{block.overlays.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="h-px bg-white/10" />

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" /> Move up
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index >= total - 1}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Move down
          </button>
        </div>
        <button
          type="button"
          onClick={onToggleGuides}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
            showGuides ? 'bg-[#ecd9ad] text-[#1e3a2f]' : 'bg-white/5 text-white/85 hover:bg-white/10'
          }`}
        >
          <Frame className="h-3.5 w-3.5" /> {showGuides ? 'Hide guides' : 'Show guides'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-red-500/15 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/25"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete spread
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-white/45">
        Pick a photo from the tray and tap an empty frame to place it, or use the on-page controls to add overlays and
        adjust crops.
      </p>
    </aside>
  );
}
