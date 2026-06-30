'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload, Trash2, Eye, EyeOff, Pencil, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  presignStickerUpload,
  createSticker,
  renameSticker,
  setStickerActive,
  deleteSticker,
  createStickerCategory,
} from '@/lib/actions/admin/stickers';
import type { AdminSticker, AdminStickerCategory } from '@/lib/admin/stickers';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// Checkerboard so transparent PNG stickers are clearly visible against it.
const CHECKER = 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 14px 14px';

export default function StickersManager({
  stickers,
  categories,
}: {
  stickers: AdminSticker[];
  categories: AdminStickerCategory[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState<AdminSticker | null>(null);
  const [toDelete, setToDelete] = useState<AdminSticker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const upload = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the sticker a name.');
    if (!file) return setError('Choose an image file.');
    setBusy(true);
    try {
      const pre = await presignStickerUpload({ filename: file.name, contentType: file.type, size: file.size });
      if (!pre.ok) return setError(pre.error);
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) return setError('Upload to storage failed.');
      const res = await createSticker({
        name: name.trim(),
        categoryId: categoryId || null,
        imageKey: pre.key,
        sort: stickers.length,
      });
      if (!res.ok) return setError(res.error);
      setName('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    setError(null);
    if (!newCategory.trim()) return;
    setBusy(true);
    const res = await createStickerCategory({ name: newCategory.trim() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setNewCategory('');
    router.refresh();
  };

  const toggle = async (s: AdminSticker) => {
    await setStickerActive({ stickerId: s.id, active: !s.active });
    router.refresh();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    const res = await deleteSticker({ stickerId: toDelete.id });
    setBusy(false);
    setToDelete(null);
    if (!res.ok) setError(res.error);
    router.refresh();
  };

  const saveEdit = async (next: { name: string; categoryId: string | null }) => {
    if (!editing) return;
    setBusy(true);
    const res = await renameSticker({ stickerId: editing.id, name: next.name, categoryId: next.categoryId });
    setBusy(false);
    setEditing(null);
    if (!res.ok) setError(res.error);
    router.refresh();
  };

  // Group stickers by category for the catalogue, preserving category order; uncategorized last.
  const groups = useMemo(() => {
    const out: { id: string; name: string; items: AdminSticker[] }[] = categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: stickers.filter((s) => s.categoryId === c.id),
    }));
    const uncategorized = stickers.filter((s) => !s.categoryId || !catName.has(s.categoryId));
    if (uncategorized.length) out.push({ id: 'uncategorized', name: 'Uncategorized', items: uncategorized });
    return out.filter((g) => g.items.length > 0);
  }, [stickers, categories, catName]);

  return (
    <div className="space-y-6">
      {/* Upload + add category */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Add a sticker</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Palm tree" maxLength={100} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Artwork (PNG/JPEG/WebP)</label>
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <Button size="sm" onClick={upload} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Transparent PNGs render best. Stickers can be placed on the cover and any album page.</p>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">New category</label>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Festivals" maxLength={60} className="w-48" />
          </div>
          <Button size="sm" variant="outline" onClick={addCategory} disabled={busy || !newCategory.trim()}>
            <FolderPlus /> Add category
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </section>

      {/* Catalogue grouped by category */}
      {stickers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stickers yet. Upload one above.</p>
      ) : (
        groups.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {g.items.map((s) => (
                <div key={s.id} className={`overflow-hidden rounded-lg border bg-card ${s.active ? '' : 'opacity-60'}`}>
                  <div className="relative aspect-square w-full" style={{ background: CHECKER }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.thumbUrl} alt={s.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                    {!s.active && (
                      <span className="absolute left-1 top-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">Hidden</span>
                    )}
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-medium" title={s.name}>
                        {s.name}
                      </span>
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(s)} aria-label="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => toggle(s)} aria-label={s.active ? 'Hide' : 'Show'}>
                          {s.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setToDelete(s)} aria-label="Delete" className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(s.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {/* Edit (rename + recategorize) */}
      {editing && (
        <EditDialog
          sticker={editing}
          categories={categories}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}

      {/* Delete confirmation */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setToDelete(null)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Delete “{toDelete.name}”?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently removes the sticker and its artwork. Albums that already placed it will simply stop showing
              it. To keep existing placements, hide it instead.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setToDelete(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditDialog({
  sticker,
  categories,
  busy,
  onCancel,
  onSave,
}: {
  sticker: AdminSticker;
  categories: AdminStickerCategory[];
  busy: boolean;
  onCancel: () => void;
  onSave: (next: { name: string; categoryId: string | null }) => void;
}) {
  const [name, setName] = useState(sticker.name);
  const [categoryId, setCategoryId] = useState<string>(sticker.categoryId ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Edit sticker</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave({ name: name.trim(), categoryId: categoryId || null })} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Pencil />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
