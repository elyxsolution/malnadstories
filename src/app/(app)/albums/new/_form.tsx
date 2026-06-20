'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Expand, X } from 'lucide-react';
import { createAlbum, type AlbumActionState } from '@/lib/actions/albums';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LUX_PRIMARY } from '@/components/brand';
import type { CoverOption } from '@/lib/covers';

type Product = {
  id: string;
  name: string;
  pages: number;
  basePrice: string;
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</p>
);

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || disabled} className={`w-full ${LUX_PRIMARY}`}>
      {pending ? 'Creating…' : 'Open the builder'}
    </Button>
  );
}

export default function CreateAlbumForm({ products, covers }: { products: Product[]; covers: CoverOption[] }) {
  const [state, formAction] = useFormState<AlbumActionState, FormData>(createAlbum, null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [previewCover, setPreviewCover] = useState<CoverOption | null>(null);

  return (
    <form action={formAction} className="space-y-7">
      <div className="space-y-2">
        <Label htmlFor="title">The title</Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="Name your story…"
          autoComplete="off"
          required
          className="h-auto border-0 border-b border-input bg-transparent px-0 py-2 font-display text-2xl font-medium shadow-none focus-visible:border-primary focus-visible:ring-0"
        />
      </div>

      {/* Optional metadata (Phase 2A) — never blocks creation. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="destination">
            Destination <span className="font-normal text-muted-foreground">· optional</span>
          </Label>
          <Input id="destination" name="destination" type="text" placeholder="Where to?" autoComplete="off" maxLength={120} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="travelDates">
            Travel dates <span className="font-normal text-muted-foreground">· optional</span>
          </Label>
          <Input id="travelDates" name="travelDates" type="text" placeholder="When?" autoComplete="off" maxLength={60} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">
          A few words <span className="font-normal text-muted-foreground">· optional</span>
        </Label>
        <textarea
          id="description"
          name="description"
          rows={2}
          maxLength={500}
          placeholder="What made this trip worth keeping?"
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="space-y-3">
        <SectionLabel>Choose its form</SectionLabel>
        <div className="grid gap-2.5">
          {products.map((product, i) => (
            <label
              key={product.id}
              className="flex cursor-pointer items-center justify-between rounded-xl border bg-card px-4 py-3.5 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04] has-[:checked]:ring-1 has-[:checked]:ring-primary/30"
            >
              <div className="flex items-center gap-3">
                <input type="radio" name="productId" value={product.id} defaultChecked={i === 0} required />
                <div>
                  <p className="font-display text-base font-semibold tracking-tight">{product.pages} pages</p>
                  <p className="text-xs text-muted-foreground">{product.name}</p>
                </div>
              </div>
              <span className="font-display text-lg font-semibold tabular-nums">
                ₹{Number(product.basePrice).toLocaleString('en-IN')}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Cover template — mandatory, chosen here at creation. */}
      <div className="space-y-3">
        <SectionLabel>Cover design</SectionLabel>
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
                  className={`group relative overflow-hidden rounded-xl border bg-muted transition-all ${
                    selected ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-ring'
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
