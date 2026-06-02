'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Save, Send, Loader2, CheckCircle2, LayoutGrid, Eye } from 'lucide-react';
import Uploader, { type Photo } from './_uploader';
import Tray from './_tray';
import BlockCard from './_block';
import Preview from './_preview';
import PhotoEditor from './_photo-editor';
import {
  LAYOUT_TEMPLATES,
  TEMPLATE_LABEL,
  PAGE_COST,
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
import { saveLayout, submitAlbum } from '@/lib/actions/builder';
import { Button } from '@/components/ui/button';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function Builder({
  albumId,
  title,
  size,
  initialStatus,
  initialPhotos,
  initialBlocks,
}: {
  albumId: string;
  title: string;
  size: number;
  initialStatus: string;
  initialPhotos: Photo[];
  initialBlocks: Block[];
}) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [status, setStatus] = useState(initialStatus);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const placed = useMemo(() => placedPhotoIds(blocks), [blocks]);
  const availablePhotos = useMemo(() => photos.filter((p) => !placed.has(p.id)), [photos, placed]);

  const consumed = pagesConsumed(blocks);
  const remaining = size - consumed;
  const complete = isAlbumComplete(blocks, size);

  // ── photos ──────────────────────────────────────────────────────────────────
  const onUploaded = (photo: Photo) => setPhotos((prev) => [...prev, photo]);

  // Pull a photo out of every base slot AND every overlay (placed at most once).
  const stripPhoto = (list: Block[], id: string): Block[] =>
    list.map((b) => {
      const inBase = b.photoIds[0] === id;
      const overlays = b.overlays.filter((o) => o.photoId !== id);
      if (!inBase && overlays.length === b.overlays.length) return b;
      return { ...b, photoIds: inBase ? [] : b.photoIds, overlays };
    });

  const onPhotoDeleted = (id: string) => {
    setBlocks((prev) => stripPhoto(prev, id));
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const onPhotoSaved = (photoId: string, edit: EditConfig) =>
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, edit } : p)));

  // ── blocks ──────────────────────────────────────────────────────────────────
  const addBlock = (template: LayoutTemplate) => {
    if (!canAdd(blocks, size, template)) return;
    setBlocks((prev) => [...prev, { key: crypto.randomUUID(), template, photoIds: [], caption: '', overlays: [] }]);
  };

  const patchBlock = (key: string, patch: Partial<Block>) =>
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const removeBlock = (key: string) => setBlocks((prev) => prev.filter((b) => b.key !== key));

  const moveBlock = (key: string, dir: -1 | 1) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const assignBase = (key: string, photoId: string) =>
    setBlocks((prev) =>
      stripPhoto(prev, photoId).map((b) => (b.key === key ? { ...b, photoIds: [photoId] } : b)),
    );

  // Clearing the base empties the base slot but KEEPS overlays — the block stays
  // incomplete (submit blocked) until a base photo is chosen again.
  const clearBase = (key: string) =>
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, photoIds: [] } : b)));

  const addOverlay = (key: string, photoId: string) =>
    setBlocks((prev) =>
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
    setBlocks((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        const overlays = b.overlays.map((o, i) => (i === index ? { ...o, photoId } : o));
        return { ...b, overlays };
      }),
    );

  const patchOverlays = (key: string, overlays: Overlay[]) =>
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, overlays } : b)));

  // ── persist ─────────────────────────────────────────────────────────────────
  const serialize = () =>
    blocks.map((b) => ({
      template: b.template,
      photoIds: b.photoIds.filter(Boolean),
      caption: b.caption,
      overlays: b.overlays,
    }));

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const res = await saveLayout({ albumId, blocks: serialize() });
    setSaving(false);
    setMessage(res.ok ? { kind: 'ok', text: 'Layout saved.' } : { kind: 'err', text: res.error });
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
    const res = await submitAlbum(albumId);
    setSubmitting(false);
    if (res.ok) {
      setStatus('submitted');
      setMessage({ kind: 'ok', text: 'Album submitted! You can still edit it until you place an order.' });
    } else {
      setMessage({ kind: 'err', text: res.error });
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
          <Button variant="outline" size="sm" onClick={save} disabled={saving || submitting}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          <Button size="sm" onClick={submit} disabled={!complete || saving || submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit
          </Button>
        </div>
      </div>

      {/* Accounting bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
        <span>
          <span className="font-medium">{consumed}</span> / {size} pages used
        </span>
        <span className={remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {remaining >= 0 ? `${remaining} remaining` : `${-remaining} over the limit`}
        </span>
        {!complete && remaining === 0 && <span className="text-muted-foreground">· fill every main photo to submit</span>}
        {complete && <span className="text-primary">· ready to submit</span>}
      </div>

      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-primary' : 'text-destructive'}`}>{message.text}</p>}

      {view === 'preview' ? (
        <Preview blocks={blocks} photoMap={photoMap} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Sidebar: upload + tray */}
          <aside className="space-y-4">
            <Uploader albumId={albumId} remaining={photoCap(size) - photos.length} onUploaded={onUploaded} />
            <div>
              <h2 className="mb-2 text-sm font-semibold">Photos</h2>
              <Tray photos={photos} placedIds={placed} onEdit={setEditingPhoto} onDeleted={onPhotoDeleted} />
            </div>
          </aside>

          {/* Main: add block + block list */}
          <main className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {LAYOUT_TEMPLATES.map((t) => (
                <Button key={t} variant="outline" size="sm" onClick={() => addBlock(t)} disabled={!canAdd(blocks, size, t)}>
                  <Plus /> {TEMPLATE_LABEL[t]}
                  <span className="text-xs text-muted-foreground">
                    ({PAGE_COST[t]} {PAGE_COST[t] === 1 ? 'page' : 'pages'})
                  </span>
                </Button>
              ))}
            </div>

            {blocks.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No pages yet. Add a layout block above to begin arranging your album.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
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
                    onAssignBase={(photoId) => assignBase(block.key, photoId)}
                    onClearBase={() => clearBase(block.key)}
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
          onClose={() => setEditingPhoto(null)}
          onSaved={(edit) => onPhotoSaved(editingPhoto.id, edit)}
        />
      )}
    </div>
  );
}
