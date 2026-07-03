'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, X, BookImage, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { categoryLabel } from '@/lib/templates/model';
import { createBlankBlueprint } from '@/lib/actions/admin/templates';

const CATEGORIES = ['solo', 'pair', 'collage', 'panoramic', 'story'] as const;

/**
 * "+ New Blueprint" — the primary way to author a whole-album blueprint. Pick a size + name, and
 * we open an EMPTY album in the existing builder in blueprint-edit mode (createBlankBlueprint →
 * /albums/[id]/build). Saving there distils the design back into this same blueprint. One flow for
 * create AND edit — no "Save As", no hidden builder shortcut.
 */
export default function NewBlueprintButton({ sizes }: { sizes: number[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [size, setSize] = useState<number | null>(sizes[0] ?? null);
  const [category, setCategory] = useState<string>('story');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Escape closes the dialog (unless a create is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  const create = async () => {
    if (!name.trim()) return setErr('Give the blueprint a name.');
    if (!size) return setErr('Choose an album size.');
    setErr(null);
    setBusy(true);
    const res = await createBlankBlueprint({ name: name.trim(), size, category });
    if (!res.ok) {
      setBusy(false);
      return setErr(res.error);
    }
    router.push(`/albums/${res.albumId}/build`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-4 w-4" /> New Blueprint
      </button>

      {open && (
        <div
          className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-[2px]"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-bp-title"
            className="animate-rise w-full max-w-md overflow-hidden rounded-2xl border bg-background shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-studio/[0.08] text-studio ring-1 ring-studio/15">
                  <BookImage className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="new-bp-title" className="text-[15px] font-semibold tracking-tight">New Blueprint</h2>
                  <p className="text-[12px] text-muted-foreground">Design a complete album layout customers can start from.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 p-5">
              <div>
                <label htmlFor="bp-name" className="mb-1.5 block text-[12px] font-medium text-foreground">Blueprint name</label>
                <input
                  id="bp-name"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Coastal Getaway"
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-studio-bright"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-foreground">Album size</span>
                <div className="grid grid-cols-3 gap-2">
                  {sizes.map((s) => {
                    const active = size === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSize(s)}
                        aria-pressed={active}
                        className={`flex flex-col items-center rounded-xl border py-2.5 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                          active
                            ? 'border-studio bg-studio-soft text-studio ring-1 ring-studio/20'
                            : 'border-border bg-card text-foreground hover:border-studio/40 hover:bg-studio-soft/40'
                        }`}
                      >
                        <span className="text-lg font-semibold tabular-nums">{s}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">pages</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="bp-cat" className="mb-1.5 block text-[12px] font-medium text-foreground">Category</label>
                <select
                  id="bp-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{categoryLabel(c)}</option>
                  ))}
                </select>
              </div>

              {err && <p className="text-[13px] font-medium text-destructive">{err}</p>}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={busy || !name.trim() || !size} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Open builder
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
