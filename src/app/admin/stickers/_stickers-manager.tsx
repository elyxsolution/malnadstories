'use client';

import { useMemo, useRef, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { Upload, Trash2, Eye, EyeOff, Pencil, FolderPlus, Search, Repeat2, ChevronUp, ChevronDown, X, GripVertical, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  presignStickerUpload,
  createSticker,
  renameSticker,
  setStickerActive,
  deleteSticker,
  replaceStickerArtwork,
  reorderStickers,
  setStickersActiveBulk,
  deleteStickersBulk,
  createStickerCategory,
  renameStickerCategory,
  deleteStickerCategory,
  reorderStickerCategories,
} from '@/lib/actions/admin/stickers';
import type { AdminSticker, AdminStickerCategory } from '@/lib/admin/stickers';

const ACCEPT = 'image/png,image/jpeg,image/webp';
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// Checkerboard so transparent PNG stickers are clearly visible against it.
const CHECKER = 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 50% / 14px 14px';
type StatusFilter = 'all' | 'active' | 'hidden';

export default function StickersManager({
  stickers,
  categories,
}: {
  stickers: AdminSticker[];
  categories: AdminStickerCategory[];
}) {
  const router = useRouter();
  // Upload form
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Dialogs / modals
  const [editing, setEditing] = useState<AdminSticker | null>(null);
  const [toDelete, setToDelete] = useState<AdminSticker | null>(null);
  const [preview, setPreview] = useState<AdminSticker | null>(null);
  const [manageCats, setManageCats] = useState(false);

  // Filters + selection + drag
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>(() => stickers.map((s) => s.id));
  const [dragId, setDragId] = useState<string | null>(null);

  // Replace artwork
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const byId = useMemo(() => new Map(stickers.map((s) => [s.id, s])), [stickers]);

  // Apply the local drag order, then filter. Reorder is only allowed in the unfiltered view.
  const ordered = useMemo(() => {
    const known = order.filter((id) => byId.has(id));
    const missing = stickers.filter((s) => !known.includes(s.id)).map((s) => s.id);
    return [...known, ...missing].map((id) => byId.get(id)!).filter(Boolean);
  }, [order, byId, stickers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((s) => {
      if (catFilter === 'all' ? false : catFilter === 'uncategorized' ? !!s.categoryId : s.categoryId !== catFilter) return false;
      if (statusFilter === 'active' && !s.active) return false;
      if (statusFilter === 'hidden' && s.active) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q)) ||
        (s.categoryId ? (catName.get(s.categoryId) ?? '').toLowerCase().includes(q) : false)
      );
    });
  }, [ordered, query, catFilter, statusFilter, catName]);

  const reorderable = query.trim() === '' && catFilter === 'all' && statusFilter === 'all';

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok && res.error) setError(res.error);
    router.refresh();
  };

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
      // Tags are applied afterwards via the Edit dialog (createSticker takes no tags).
      setName('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  // Replace artwork: presign → PUT → replaceStickerArtwork (keeps the same sticker id).
  const onReplaceFile = async (f: File) => {
    const id = replacingId;
    setReplacingId(null);
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const pre = await presignStickerUpload({ filename: f.name, contentType: f.type, size: f.size });
      if (!pre.ok) return setError(pre.error);
      const put = await fetch(pre.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.type }, body: f });
      if (!put.ok) return setError('Upload to storage failed.');
      const res = await replaceStickerArtwork({ stickerId: id, imageKey: pre.key });
      if (!res.ok) return setError(res.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  // Drag reorder (unfiltered view only). Persist the full id order on drop.
  const onDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const ids = ordered.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return setDragId(null);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    setDragId(null);
    await reorderStickers({ ids });
    router.refresh();
  };

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSel = () => setSelected(new Set());
  const selIds = () => Array.from(selected);

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
                <option key={c.id} value={c.id}>{c.name}</option>
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
            {busy ? <InlineLoader /> : <Upload />} Upload
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Transparent PNGs render best. Add tags after upload via Edit. Stickers can be placed on the cover and any album page.</p>

        <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">New category</label>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Festivals" maxLength={60} className="w-48" />
          </div>
          <Button size="sm" variant="outline" onClick={() => run(() => createStickerCategory({ name: newCategory.trim() })).then(() => setNewCategory(''))} disabled={busy || !newCategory.trim()}>
            <FolderPlus /> Add category
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setManageCats((v) => !v)}>
            {manageCats ? 'Done' : 'Manage categories'}
          </Button>
        </div>

        {manageCats && (
          <CategoryManager categories={categories} busy={busy} run={run} />
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or tags…"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="uncategorized">Uncategorized</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
          <span className="px-1 text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setStickersActiveBulk({ ids: selIds(), active: true })).then(clearSel)}>
            <Eye /> Enable
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setStickersActiveBulk({ ids: selIds(), active: false })).then(clearSel)}>
            <EyeOff /> Disable
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => deleteStickersBulk({ ids: selIds() })).then(clearSel)}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSel}>Clear</Button>
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {stickers.length === 0 ? 'No stickers yet. Upload one above.' : 'No stickers match your filters.'}
        </p>
      ) : (
        <>
          {reorderable && <p className="text-[11px] text-muted-foreground">Drag the handle to reorder how stickers appear to customers.</p>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {filtered.map((s) => {
              const sel = selected.has(s.id);
              return (
                <div
                  key={s.id}
                  draggable={reorderable}
                  onDragStart={() => reorderable && setDragId(s.id)}
                  onDragOver={(e) => reorderable && e.preventDefault()}
                  onDrop={() => reorderable && onDrop(s.id)}
                  className={`relative overflow-hidden rounded-lg border bg-card ${s.active ? '' : 'opacity-60'} ${sel ? 'ring-2 ring-studio-bright' : ''} ${dragId === s.id ? 'opacity-40' : ''}`}
                >
                  {/* Selection checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleSel(s.id)}
                    aria-label={sel ? 'Deselect' : 'Select'}
                    className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded border bg-background/90 ${sel ? 'border-studio-bright text-studio' : 'border-border text-transparent'}`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  {reorderable && (
                    <span className="absolute right-1.5 top-1.5 z-10 cursor-grab text-muted-foreground/70"><GripVertical className="h-4 w-4" /></span>
                  )}

                  <button type="button" onClick={() => setPreview(s)} className="relative block aspect-square w-full" style={{ background: CHECKER }} aria-label={`Preview ${s.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.thumbUrl} alt={s.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                    {!s.active && <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">Hidden</span>}
                    {s.usageCount > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-studio/90 px-1.5 py-0.5 text-[10px] font-medium text-white">{s.usageCount} in use</span>
                    )}
                  </button>

                  <div className="space-y-1 p-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-medium" title={s.name}>{s.name}</span>
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(s)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => { setReplacingId(s.id); replaceRef.current?.click(); }} aria-label="Replace artwork"><Repeat2 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => run(() => setStickerActive({ stickerId: s.id, active: !s.active }))} aria-label={s.active ? 'Hide' : 'Show'}>
                          {s.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setToDelete(s)} aria-label="Delete" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    {s.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                        ))}
                        {s.tags.length > 3 && <span className="text-[9px] text-muted-foreground">+{s.tags.length - 3}</span>}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">{s.categoryId ? catName.get(s.categoryId) ?? '—' : 'Uncategorized'} · {fmtDate(s.createdAt)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Hidden input for artwork replacement */}
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onReplaceFile(f);
          e.target.value = '';
        }}
      />

      {editing && (
        <EditDialog sticker={editing} categories={categories} busy={busy} onCancel={() => setEditing(null)} onSave={(next) => run(() => renameSticker({ stickerId: editing.id, ...next })).then(() => setEditing(null))} />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-square w-full" style={{ background: CHECKER }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.thumbUrl} alt={preview.name} className="absolute inset-0 h-full w-full object-contain p-6" />
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">{preview.name}</p>
                <p className="text-[11px] text-muted-foreground">{preview.usageCount} album{preview.usageCount === 1 ? '' : 's'} · {preview.active ? 'Active' : 'Hidden'}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}><X /> Close</Button>
            </div>
          </div>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setToDelete(null)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Delete “{toDelete.name}”?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently removes the sticker and its artwork. Albums that already placed it will simply stop showing it. To keep existing placements, hide it instead.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setToDelete(null)} disabled={busy}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => run(() => deleteSticker({ stickerId: toDelete.id })).then(() => setToDelete(null))} disabled={busy}>
                {busy ? <InlineLoader /> : <Trash2 />} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryManager({
  categories,
  busy,
  run,
}: {
  categories: AdminStickerCategory[];
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const move = (i: number, dir: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderStickerCategories({ ids }));
  };
  return (
    <div className="mt-3 space-y-1 rounded-lg border bg-background p-3">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Categories</p>
      {categories.length === 0 && <p className="text-xs text-muted-foreground">No categories yet.</p>}
      {categories.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          <button type="button" onClick={() => move(i, -1)} disabled={busy || i === 0} className="text-muted-foreground disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => move(i, 1)} disabled={busy || i === categories.length - 1} className="text-muted-foreground disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
          {editingId === c.id ? (
            <>
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} className="h-8 flex-1" />
              <Button size="sm" onClick={() => run(() => renameStickerCategory({ categoryId: c.id, name: draft.trim() })).then(() => setEditingId(null))} disabled={busy || !draft.trim()}><Check className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button>
            </>
          ) : (
            <>
              <span className="flex-1 truncate text-sm">{c.name}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => { setEditingId(c.id); setDraft(c.name); }} aria-label="Rename"><Pencil className="h-4 w-4" /></Button>
              <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => run(() => deleteStickerCategory({ categoryId: c.id }))} aria-label="Delete category"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">Deleting a category keeps its stickers — they become Uncategorized.</p>
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
  onSave: (next: { name: string; categoryId: string | null; tags: string[] }) => void;
}) {
  const [name, setName] = useState(sticker.name);
  const [categoryId, setCategoryId] = useState<string>(sticker.categoryId ?? '');
  const [tags, setTags] = useState(sticker.tags.join(', '));
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
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Tags (comma-separated)</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="summer, beach, palm" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => onSave({ name: name.trim(), categoryId: categoryId || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })} disabled={busy || !name.trim()}>
            {busy ? <InlineLoader /> : <Pencil />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
