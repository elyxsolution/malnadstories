'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Expand, X } from 'lucide-react';
import { createAlbum, type AlbumActionState } from '@/lib/actions/albums';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { CoverOption } from '@/lib/covers';

type Product = {
  id: string;
  name: string;
  pages: number;
  basePrice: string;
};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full">
      {pending ? 'Creating…' : 'Create album'}
    </Button>
  );
}

export default function CreateAlbumForm({ products, covers }: { products: Product[]; covers: CoverOption[] }) {
  const [state, formAction] = useFormState<AlbumActionState, FormData>(createAlbum, null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [previewCover, setPreviewCover] = useState<CoverOption | null>(null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">Album title</Label>
        <Input id="title" name="title" type="text" placeholder="E.g. Coorg trip 2024" autoComplete="off" required />
      </div>

      <div className="space-y-2">
        <Label>Size</Label>
        <div className="space-y-2">
          {products.map((product, i) => (
            <label
              key={product.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer has-[:checked]:border-foreground has-[:checked]:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <input type="radio" name="productId" value={product.id} defaultChecked={i === 0} required />
                <div>
                  <p className="text-sm font-medium">{product.pages} pages</p>
                  <p className="text-xs text-muted-foreground">{product.name}</p>
                </div>
              </div>
              <span className="text-sm font-medium">₹{Number(product.basePrice).toLocaleString('en-IN')}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Cover template — mandatory, chosen here at creation. */}
      <div className="space-y-2">
        <Label>Cover design</Label>
        <input type="hidden" name="coverTemplateId" value={coverId ?? ''} />
        {covers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No cover designs are available yet. Please check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {covers.map((c) => {
              const selected = coverId === c.id;
              return (
                <div
                  key={c.id}
                  className={`group relative overflow-hidden rounded-lg border bg-muted transition-all ${
                    selected ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-ring'
                  }`}
                >
                  <button type="button" onClick={() => setCoverId(c.id)} className="block w-full text-left" aria-pressed={selected}>
                    <div className="relative aspect-[3/4] w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.thumbUrl} alt={c.name} className="absolute inset-0 h-full w-full object-cover" />
                    </div>
                    <span className="block truncate px-2 py-1.5 text-xs font-medium">{c.name}</span>
                  </button>
                  {/* Preview Cover — opens the full image larger. */}
                  <button
                    type="button"
                    onClick={() => setPreviewCover(c)}
                    aria-label={`Preview ${c.name}`}
                    className="absolute right-1 top-1 inline-flex items-center gap-1 rounded bg-background/85 px-1.5 py-1 text-[10px] font-medium opacity-0 shadow-sm transition-opacity hover:bg-background group-hover:opacity-100"
                  >
                    <Expand className="h-3 w-3" /> Preview
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <SubmitButton disabled={!coverId || covers.length === 0} />

      {/* Larger cover preview modal */}
      {previewCover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewCover(null)}>
          <div className="relative max-h-[90vh] w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewCover(null)}
              aria-label="Close preview"
              className="absolute -top-3 -right-3 z-10 rounded-full bg-background p-1.5 shadow"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="overflow-hidden rounded-xl border bg-background">
              <div className="relative aspect-[3/4] w-full bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewCover.url} alt={previewCover.name} className="absolute inset-0 h-full w-full object-contain" />
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold">{previewCover.name}</p>
                {previewCover.description && <p className="text-xs text-muted-foreground">{previewCover.description}</p>}
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    setCoverId(previewCover.id);
                    setPreviewCover(null);
                  }}
                >
                  {coverId === previewCover.id ? 'Selected' : 'Select this cover'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
