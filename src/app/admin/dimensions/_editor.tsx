'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Upload, Star, Power, GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  saveProduct,
  setProductActive,
  setDefaultProduct,
  setProductCoverPreview,
  addProductPreview,
  removeProductPreview,
  reorderProductPreviews,
} from '@/lib/actions/admin/products';
import { presignProductUpload } from '@/lib/actions/admin/product-uploads';
import { removeProductDemoAlbum } from '@/lib/actions/admin/product-demo';
import DemoAlbumPicker from './_demo-picker';
import type { AdminProduct, AdminProductPreview } from '@/lib/admin/products';

type PriceRow = { pageCount: string; price: string };
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Upload a file straight to R2 via a presigned PUT; returns the object key. */
async function uploadImage(file: File): Promise<string> {
  const presign = await presignProductUpload({ contentType: file.type, size: file.size });
  if (!presign.ok) throw new Error(presign.error);
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error('Upload failed.');
  return presign.key;
}

export default function ProductEditor({ product }: { product: AdminProduct | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [widthCm, setWidthCm] = useState(product ? String(product.widthCm) : '');
  const [heightCm, setHeightCm] = useState(product ? String(product.heightCm) : '');
  const [printWidthCm, setPrintWidthCm] = useState(product ? String(product.printWidthCm) : '');
  const [printHeightCm, setPrintHeightCm] = useState(product ? String(product.printHeightCm) : '');
  const [displayOrder, setDisplayOrder] = useState(product ? String(product.displayOrder) : '0');
  const [bestFor, setBestFor] = useState(product?.bestFor?.join(', ') ?? '');
  const [prices, setPrices] = useState<PriceRow[]>(
    product && product.prices.length
      ? product.prices.map((p) => ({ pageCount: String(p.pageCount), price: String(p.price) }))
      : [{ pageCount: '24', price: '' }],
  );

  // Live preview aspect (width/height). Defaults keep the box sane while empty.
  const aspect = useMemo(() => {
    const w = Number(widthCm);
    const h = Number(heightCm);
    return w > 0 && h > 0 ? w / h : 0.7071;
  }, [widthCm, heightCm]);

  const setPrice = (i: number, patch: Partial<PriceRow>) =>
    setPrices((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addPrice = () => setPrices((prev) => [...prev, { pageCount: '', price: '' }]);
  const removePrice = (i: number) => setPrices((prev) => prev.filter((_, idx) => idx !== i));

  // If the admin leaves print size blank on a new product, mirror the physical size.
  const onSave = () => {
    setError(null);
    const w = Number(widthCm),
      h = Number(heightCm);
    const pw = printWidthCm ? Number(printWidthCm) : w;
    const ph = printHeightCm ? Number(printHeightCm) : h;
    const payload = {
      ...(product ? { id: product.id } : {}),
      name,
      description: description || undefined,
      widthCm: w,
      heightCm: h,
      printWidthCm: pw,
      printHeightCm: ph,
      displayOrder: Number(displayOrder) || 0,
      bestFor: bestFor
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8),
      prices: prices
        .filter((r) => r.pageCount && r.price)
        .map((r) => ({ pageCount: Number(r.pageCount), price: Number(r.price) })),
    };
    startTransition(async () => {
      const res = await saveProduct(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // New product → go to its edit page so images can be attached.
      if (!product) router.push(`/admin/dimensions/${res.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        {/* ── Form ─────────────────────────────────────────────── */}
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Details</h2>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard" maxLength={60} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Everyday A4 photo album — crisp, lightweight, beautifully bound."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="order">Display order</Label>
                <Input id="order" type="number" min={0} value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bestfor">Best for</Label>
                <Input id="bestfor" value={bestFor} onChange={(e) => setBestFor(e.target.value)} placeholder="Travel, Wedding, Family" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Comma-separated tags shown in the customer preview panel (up to 8).</p>
          </section>

          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Dimensions (cm)</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Width" value={widthCm} onChange={setWidthCm} />
              <Field label="Height" value={heightCm} onChange={setHeightCm} />
              <Field label="Print width" value={printWidthCm} onChange={setPrintWidthCm} placeholder={widthCm || '—'} />
              <Field label="Print height" value={printHeightCm} onChange={setPrintHeightCm} placeholder={heightCm || '—'} />
            </div>
            <p className="text-xs text-muted-foreground">
              Builder aspect ratio is derived as width ÷ height ={' '}
              <span className="font-medium tabular-nums text-foreground">{aspect.toFixed(4)}</span>. Print size defaults to the
              physical size if left blank.
            </p>
          </section>

          <section className="space-y-3 rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Page counts &amp; prices</h2>
              <Button size="xs" variant="outline" onClick={addPrice}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {prices.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={1}
                      placeholder="Pages (e.g. 24)"
                      value={r.pageCount}
                      onChange={(e) => setPrice(i, { pageCount: e.target.value })}
                    />
                  </div>
                  <span className="text-muted-foreground">₹</span>
                  <div className="flex-1">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Price"
                      value={r.price}
                      onChange={(e) => setPrice(i, { price: e.target.value })}
                    />
                  </div>
                  <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => removePrice(i)} aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <Button size="lg" onClick={onSave} disabled={pending}>
              {pending && <InlineLoader />}
              {product ? 'Save changes' : 'Create product'}
            </Button>
            {product && <StatusToggles product={product} />}
          </div>
        </div>

        {/* ── Live preview ─────────────────────────────────────── */}
        <aside className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live preview</p>
          <div className="rounded-2xl border bg-muted/30 p-4">
            <div className="mx-auto flex items-end justify-center gap-1" style={{ height: 200 }}>
              {/* Open pair = two pages side by side, at the product's aspect. */}
              <div className="h-full rounded-sm bg-white shadow-md ring-1 ring-black/10" style={{ aspectRatio: aspect }} />
              <div className="h-full rounded-sm bg-white shadow-md ring-1 ring-black/10" style={{ aspectRatio: aspect }} />
            </div>
            <p className="mt-3 text-center text-xs tabular-nums text-muted-foreground">
              {widthCm || '—'} × {heightCm || '—'} cm · one page
            </p>
          </div>
          {prices.some((p) => p.price) && (
            <p className="text-center text-sm text-muted-foreground">
              From <span className="font-semibold text-foreground">{inr(Math.min(...prices.filter((p) => p.price).map((p) => Number(p.price))))}</span>
            </p>
          )}
        </aside>
      </div>

      {/* ── Demo album + Images (existing products only) ─────── */}
      {product ? (
        <>
          <DemoAlbumSection product={product} />
          <ImageManager product={product} />
        </>
      ) : (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Save the product to assign a demo album and upload its cover preview and gallery images.
        </p>
      )}
    </div>
  );
}

// ── Demo album ────────────────────────────────────────────────────────────────
function DemoAlbumSection({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  const remove = () =>
    startTransition(async () => {
      await removeProductDemoAlbum({ id: product.id });
      router.refresh();
    });

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Demo album (interactive preview)</h2>
        <p className="text-xs text-muted-foreground">
          Assign a real, designed album — customers flip through it exactly as it will print. Falls back to the gallery
          images when none is set.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex-1">
          {product.demoAlbumId ? (
            <p className="text-sm font-medium text-foreground">
              {product.demoAlbumTitle ?? 'Untitled album'}{' '}
              <span className="text-xs font-normal text-muted-foreground">· assigned</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No demo album — using gallery images.</p>
          )}
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setPickerOpen(true)}>
          {product.demoAlbumId ? 'Replace' : 'Select demo album'}
        </Button>
        {product.demoAlbumId && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={remove}>
            Remove
          </Button>
        )}
      </div>
      {pickerOpen && <DemoAlbumPicker productId={product.id} onClose={() => setPickerOpen(false)} />}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min={0} step="0.1" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function StatusToggles({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean }>) => startTransition(async () => { await fn(); router.refresh(); });
  return (
    <div className="flex items-center gap-2">
      {!product.isDefault && (
        <Button size="sm" variant="ghost" disabled={pending || !product.isActive} onClick={() => act(() => setDefaultProduct({ id: product.id }))}>
          <Star className="h-3.5 w-3.5" /> Set default
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setProductActive({ id: product.id, isActive: !product.isActive }))}>
        <Power className="h-3.5 w-3.5" /> {product.isActive ? 'Disable' : 'Enable'}
      </Button>
      {product.isDefault && <span className="text-xs font-medium text-primary">Default product</span>}
    </div>
  );
}

// ── Image manager (cover + gallery) ───────────────────────────────────────────
function ImageManager({ product }: { product: AdminProduct }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<AdminProductPreview[]>(product.previews);
  const dragId = useRef<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const withBusy = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const onCover = (file: File) =>
    withBusy(async () => {
      const key = await uploadImage(file);
      const res = await setProductCoverPreview({ productId: product.id, imageKey: key });
      if (!res.ok) throw new Error(res.error);
    });

  const onGallery = (files: FileList) =>
    withBusy(async () => {
      for (const file of Array.from(files)) {
        const key = await uploadImage(file);
        const res = await addProductPreview({ productId: product.id, imageKey: key });
        if (!res.ok) throw new Error(res.error);
      }
    });

  const onRemove = (id: string) => withBusy(async () => {
    const res = await removeProductPreview({ id });
    if (!res.ok) throw new Error(res.error);
  });

  const commitOrder = (next: AdminProductPreview[]) => {
    setOrder(next);
    withBusy(async () => {
      const res = await reorderProductPreviews({ productId: product.id, ids: next.map((p) => p.id) });
      if (!res.ok) throw new Error(res.error);
    });
  };

  const onDrop = (targetId: string) => {
    const from = order.findIndex((p) => p.id === dragId.current);
    const to = order.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commitOrder(next);
  };

  return (
    <section className="space-y-6 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Preview imagery</h2>
        {busy && <InlineLoader />}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Cover preview */}
      <div className="flex items-center gap-4">
        <div className="relative aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-lg border bg-muted">
          {product.coverPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.coverPreviewUrl} alt="Cover preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No cover</div>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Cover preview</p>
          <p className="text-xs text-muted-foreground">The primary card image customers see.</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => coverInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> {product.coverPreviewUrl ? 'Replace' : 'Upload'}
          </Button>
          <input
            ref={coverInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onCover(e.target.files[0])}
          />
        </div>
      </div>

      {/* Gallery */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Gallery ({order.length})</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => galleryInput.current?.click()}>
            <Plus className="h-3.5 w-3.5" /> Add images
          </Button>
          <input
            ref={galleryInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && onGallery(e.target.files)}
          />
        </div>
        {order.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No gallery images yet. Add a few to power the customer preview lightbox.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {order.map((p) => (
              <div
                key={p.id}
                draggable
                onDragStart={() => (dragId.current = p.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(p.id)}
                className="group relative aspect-square cursor-grab overflow-hidden rounded-lg border bg-muted active:cursor-grabbing"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Gallery" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-foreground/60 p-0.5 text-background opacity-0 transition-opacity group-hover:opacity-100">
                  <GripVertical className="h-3 w-3" />
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  aria-label="Remove image"
                  className="absolute right-1 top-1 rounded-full bg-foreground/70 p-1 text-background opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Drag to reorder. The order shown here is the customer carousel order.</p>
      </div>
    </section>
  );
}
