'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Save, Send, Loader2, CheckCircle2, LayoutGrid, Eye, FileDown, AlertTriangle, ShoppingCart, BookImage, X } from 'lucide-react';
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
  validateAlbumForPdf,
  placedPhotoIds,
  type Block,
  type LayoutTemplate,
  type Overlay,
  type EditConfig,
} from '@/lib/builder/model';
import { saveLayout, submitAlbum, selectCover } from '@/lib/actions/builder';
import { requestAlbumPdf } from '@/lib/actions/pdf';
import { Button } from '@/components/ui/button';
import { type CoverOption } from '@/lib/covers';
import { useWorkerGate } from '@/components/worker/use-worker-gate';

type PdfStatus = 'idle' | 'generating' | 'ready' | 'failed';

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
  initialPdfStatus,
  initialPhotos,
  initialBlocks,
  covers,
  initialCoverId,
}: {
  albumId: string;
  title: string;
  size: number;
  initialStatus: string;
  initialPdfStatus: PdfStatus;
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

  // Dirty-state (REQUIREMENT 5/6): true after ANY content change; cleared ONLY by a
  // successful save. PDF generate + download are locked while dirty.
  const [dirty, setDirty] = useState(false);
  const [saveFirst, setSaveFirst] = useState(false); // the "please save first" modal

  const [pdfStatus, setPdfStatus] = useState<PdfStatus>(initialPdfStatus);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Worker readiness gate — PDF generation and uploads both require the (sleepable)
  // worker. `ensureReady` wakes it (with a modal) before the operation runs.
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
  const pdfCheck = useMemo(
    () => validateAlbumForPdf(blocks, size, !!coverId),
    [blocks, size, coverId],
  );

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

  // ── preview PDF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (pdfStatus !== 'generating') return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/albums/${albumId}/pdf`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: PdfStatus };
        if (active && body.status !== 'generating') setPdfStatus(body.status);
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [pdfStatus, albumId]);

  // Generation requires a clean save AND a valid book (REQUIREMENT 5/7).
  const requestPdf = async () => {
    if (pdfBusy || pdfStatus === 'generating') return;
    if (dirty) {
      setSaveFirst(true);
      return;
    }
    if (!pdfCheck.ok) {
      setMessage({ kind: 'err', text: pdfCheck.errors[0] });
      return;
    }
    // Worker is required to render the PDF — wake it first (modal) so we never enqueue
    // a job no worker will run before the print token expires.
    if (!(await ensureReady())) return;
    setPdfBusy(true);
    setMessage(null);
    const res = await requestAlbumPdf(albumId);
    setPdfBusy(false);
    if (res.ok) setPdfStatus('generating');
    else setMessage({ kind: 'err', text: res.error });
  };

  const downloadPdf = async () => {
    if (dirty) {
      setSaveFirst(true);
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(`/api/albums/${albumId}/pdf`);
      const body = (await res.json()) as { status: PdfStatus; url: string | null };
      if (body.status === 'ready' && body.url) {
        window.location.href = body.url;
      } else {
        setPdfStatus(body.status);
        setMessage({ kind: 'err', text: 'The PDF is no longer available — please regenerate.' });
      }
    } catch {
      setMessage({ kind: 'err', text: 'Could not fetch the PDF download link.' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header / actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            {' / '}
            {title}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            {status === 'submitted' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
              </span>
            )}
            {dirty && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">Unsaved changes</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
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
          <Button size="sm" onClick={submit} disabled={!complete || saving || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit
          </Button>

          {status === 'submitted' && (
            <Button variant="secondary" size="sm" render={<Link href={`/checkout/${albumId}`} />}>
              <ShoppingCart /> Proceed to checkout
            </Button>
          )}

          {/* Preview PDF */}
          {pdfStatus === 'generating' ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="animate-spin" /> Generating PDF…
            </Button>
          ) : pdfStatus === 'ready' ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={downloadPdf} disabled={downloading || dirty}>
                {downloading ? <Loader2 className="animate-spin" /> : <FileDown />} Download PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={requestPdf} disabled={pdfBusy || dirty}>
                Regenerate
              </Button>
            </div>
          ) : pdfStatus === 'failed' ? (
            <Button variant="outline" size="sm" onClick={requestPdf} disabled={pdfBusy}>
              <AlertTriangle className="text-destructive" /> Retry PDF
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={requestPdf} disabled={pdfBusy}>
              {pdfBusy ? <Loader2 className="animate-spin" /> : <FileDown />} Preview PDF
            </Button>
          )}
        </div>
      </div>

      {/* Accounting + cover bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
        <span>
          <span className="font-medium">{consumed}</span> / {size} content pages used
        </span>
        <span className={remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {remaining >= 0 ? `${remaining} remaining` : `${-remaining} over the limit`}
        </span>
        <span className="text-muted-foreground">· + cover & 2 blank pages added automatically</span>
        <button
          type="button"
          onClick={() => setCoverPicker(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          <BookImage className="h-3.5 w-3.5" />
          {selectedCover ? `Cover: ${selectedCover.name} · Change` : 'Choose cover'}
        </button>
      </div>

      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-primary' : 'text-destructive'}`}>{message.text}</p>}

      {view === 'preview' ? (
        <Preview blocks={blocks} photoMap={photoMap} cover={selectedCover} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
          {/* Sticky, independently-scrollable photo library: it stays in view while the
              page editor on the right scrolls. The upload area stays pinned at the top;
              the thumbnail tray scrolls within the remaining height (Canva/Figma-style).
              On lg it's a fixed-height sticky column (top: 20px); on mobile it stacks. */}
          <aside className="lg:sticky lg:top-5 lg:flex lg:max-h-[calc(100vh-2.5rem)] lg:flex-col lg:gap-4">
            <div className="mb-4 lg:mb-0 lg:shrink-0">
              <Uploader
                albumId={albumId}
                remaining={photoCap(size) - photos.length}
                onUploaded={onUploaded}
                ensureWorkerReady={ensureReady}
              />
            </div>
            <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <h2 className="mb-2 text-sm font-semibold">Photos</h2>
              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                <Tray photos={photos} placedIds={placed} onEdit={setEditingPhoto} onDeleted={onPhotoDeleted} />
              </div>
            </div>
          </aside>

          <main className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {LAYOUT_TEMPLATES.map((t) => (
                <Button key={t} variant="outline" size="sm" onClick={() => addBlock(t)} disabled={!canAdd(blocks, size, t)}>
                  <Plus /> {ADD_LABEL[t]}
                  <span className="text-xs text-muted-foreground">(2 pages)</span>
                </Button>
              ))}
            </div>

            {blocks.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No content yet. Add a Single Page (two photos) or a Double Page (one image across both) to begin.
              </div>
            ) : (
              <div className="grid gap-4">
                {blocks.map((block, i) => (
                  <BlockCard
                    key={block.key}
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
                ))}
              </div>
            )}
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

      {saveFirst && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSaveFirst(false)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Save your changes first</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Please save your changes before generating the PDF, so the file matches what you see.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSaveFirst(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const ok = await save();
                  if (ok) setSaveFirst(false);
                }}
                disabled={saving}
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save now
              </Button>
            </div>
          </div>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Change cover design</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        {covers.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No cover designs are available yet. Please check back soon.</p>
        ) : (
          <div className="mt-3 grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {covers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                className={`overflow-hidden rounded-lg border bg-muted text-left transition-all hover:ring-2 hover:ring-ring ${
                  selectedId === c.id ? 'ring-2 ring-foreground' : ''
                }`}
              >
                <div className="relative aspect-[3/4] w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumbUrl} alt={c.name} className="absolute inset-0 h-full w-full object-cover" />
                </div>
                <span className="block truncate px-2 py-1.5 text-xs font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
