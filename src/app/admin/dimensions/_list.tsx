'use client';

import { useState, useTransition } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Star, Power, Trash2, ImageOff, PackageOpen } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { setProductActive, setDefaultProduct, deleteProduct } from '@/lib/actions/admin/products';
import type { AdminProduct } from '@/lib/admin/products';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function ProductList({ products }: { products: AdminProduct[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminProduct | null>(null);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
      else router.refresh();
    });
  };

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 px-6 py-16 text-center">
        <PackageOpen className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">No album products yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Create your first product to define its dimensions and pricing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const busy = busyId === p.id && pending;
          return (
            <article
              key={p.id}
              className={`group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md ${
                p.isActive ? '' : 'opacity-75'
              }`}
            >
              {/* Cover preview */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                {p.coverPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.coverPreviewUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  {p.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm">
                      <Star className="h-3 w-3 fill-current" /> Default
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm ${
                      p.isActive ? 'bg-emerald-600 text-white' : 'bg-foreground/70 text-background'
                    }`}
                  >
                    {p.isActive ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{p.name}</h2>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {p.widthCm} × {p.heightCm} cm · print {p.printWidthCm} × {p.printHeightCm} cm · ratio{' '}
                    {p.builderAspectRatio.toFixed(3)}
                  </p>
                </div>

                {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}

                {/* Price table */}
                <div className="rounded-lg border bg-muted/30 p-2.5">
                  {p.prices.length === 0 ? (
                    <p className="text-xs text-destructive">No prices set — customers can’t order this.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      {p.prices.map((pr) => (
                        <div key={pr.pageCount} className="rounded-md bg-background px-1 py-1.5">
                          <div className="text-[11px] font-medium text-muted-foreground">{pr.pageCount}p</div>
                          <div className="text-sm font-semibold tabular-nums text-foreground">{inr(pr.price)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {p.previews.length} gallery image{p.previews.length === 1 ? '' : 's'} · used by{' '}
                  <span className="tabular-nums">{p.usedBy}</span> album/order{p.usedBy === 1 ? '' : 's'}
                </p>

                {/* Actions */}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <Link href={`/admin/dimensions/${p.id}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Link>
                  {!p.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !p.isActive}
                      onClick={() => run(p.id, () => setDefaultProduct({ id: p.id }))}
                    >
                      <Star className="h-3.5 w-3.5" /> Set default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(p.id, () => setProductActive({ id: p.id, isActive: !p.isActive }))}
                  >
                    <Power className="h-3.5 w-3.5" /> {p.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy || p.usedBy > 0}
                    title={p.usedBy > 0 ? 'In use — disable instead' : 'Delete'}
                    onClick={() => setConfirmDelete(p)}
                  >
                    {busy ? <InlineLoader /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div className="w-full max-w-sm rounded-2xl border bg-background p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Delete “{confirmDelete.name}”?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently removes the product, its prices, and preview images. This can’t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  const target = confirmDelete;
                  setConfirmDelete(null);
                  run(target.id, () => deleteProduct({ id: target.id }));
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
