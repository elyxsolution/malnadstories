'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Save, Send, Loader2, CheckCircle2, LayoutGrid, Eye, ShoppingCart, BookImage, X } from 'lucide-react';
import Uploader, { type Photo } from './_uploader';
import Tray from './_tray';
import BlockCard, { type BaseSlot } from './_block';
import Preview from './_preview';
import PhotoEditor from './_photo-editor';
import QuickCrop from './_quick-crop';
import {
  LAYOUT_TEMPLATES,
  DEFAULT_OVERLAY_GEOM,
  photoCap,
  pagesConsumed,
  canAdd,
  isAlbumComplete,
  placedPhotoIds,
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
}: {
  albumId: string;
  title: string;
  size: number;
  initialStatus: string;
  initialPhotos: Photo[];
  initialBlocks: Block[];
  covers: CoverOption[];
  initialCoverId: string | null;
}) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [status, setStatus] = useState(initialStatus);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
  const [quickCrop, setQuickCrop] = useState<{ photo: Photo; aspect: number; gutter: boolean } | null>(null);
  const [coverId, setCoverId] = useState<string | null>(initialCoverId);
  const [coverPicker, setCoverPicker] = useState(false);

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
          photos: { id: string; status: Photo['status']; url: string; thumbUrl: string; takenAt: string | null }[];
        };
        if (!active) return;
        setPhotos((prev) =>
          prev.map((p) => {
            const u = body.photos.find((x) => x.id === p.id);
            return u ? { ...p, status: u.status, url: u.url, thumbUrl: u.thumbUrl, takenAt: u.takenAt } : p;
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

  // ── dirty-aware block mutation ────────────────────────────────────────────────
  const mutateBlocks = (updater: (prev: Block[]) => Block[]) => {
    setBlocks(updater);
    setDirty(true);
  };

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
  const serialize = () =>
    blocks.map((b) => ({
      template: b.template,
      photoIds: b.photoIds.filter(Boolean),
      caption: b.caption,
      overlays: b.overlays,
    }));

  const save = async (): Promise<boolean> => {
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
  };

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
    const res = await submitAlbum(albumId);
    setSubmitting(false);
    if (res.ok) {
      setStatus('submitted');
      setMessage({ kind: 'ok', text: 'Album submitted! You can still edit it until you place an order.' });
    } else {
      setMessage({ kind: 'err', text: res.error });
    }
  };

  const pct = Math.min(100, size ? (consumed / size) * 100 : 0);

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

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs">
            <Button variant={view === 'edit' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('edit')}>
              <LayoutGrid /> Edit
            </Button>
            <Button variant={view === 'preview' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('preview')}>
              <Eye /> Preview
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={save} disabled={saving || submitting || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          <Button size="sm" onClick={submit} disabled={!complete || saving || submitting} className={LUX_PRIMARY}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit
          </Button>

          {status === 'submitted' && (
            <Button size="sm" render={<Link href={`/checkout/${albumId}`} />} className={LUX_PRIMARY}>
              <ShoppingCart /> Checkout
            </Button>
          )}
        </div>
      </div>

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
                {photos.length > 0 && (
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-secondary-foreground">
                    {photos.length}
                  </span>
                )}
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
              <Tray photos={photos} placedIds={placed} onEdit={setEditingPhoto} onDeleted={onPhotoDeleted} />
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
                    <span className="font-medium text-white/80">Double Page</span> (one image across both) to begin.
                  </p>
                </div>
              ) : (
                <div className="grid gap-7">
                  {blocks.map((block, i) => (
                    <div key={block.key} className="animate-rise" style={{ animationDelay: `${Math.min(i * 55, 330)}ms` }}>
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
                        onAddOverlay={(photoId) => addOverlay(block.key, photoId)}
                        onReplaceOverlay={(index, photoId) => replaceOverlay(block.key, index, photoId)}
                        onPatchOverlays={(overlays) => patchOverlays(block.key, overlays)}
                        onRemove={() => removeBlock(block.key)}
                        onMove={(dir) => moveBlock(block.key, dir)}
                      />
                    </div>
                  ))}
                </div>
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
