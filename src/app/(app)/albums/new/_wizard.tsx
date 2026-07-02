'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MapPin,
  Calendar,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY, Sprig } from '@/components/brand';
import { createAlbumDraft } from '@/lib/actions/albums';
import { saveLayout, applyBlueprintToAlbum, autoSelectAndApplyBlueprint } from '@/lib/actions/builder';
import { photoCap } from '@/lib/builder/model';
import { autoLayout, serializeBlocks, type EnginePhoto, type TemplateChoice } from '@/lib/builder/auto-layout';
import Book from '@/components/book';
import Uploader, { type Photo } from '../[id]/build/_uploader';
import BlueprintPicker from './_blueprint-picker';
import { LayoutTemplate, Sparkles, Dices } from 'lucide-react';
import type { CoverOption } from '@/lib/covers';

type Product = { id: string; name: string; pages: number; basePrice: string };

const STEPS = ['Begin', 'Format', 'Memories', 'Create'] as const;

// Auto Create staged loading copy (Step 5).
const AUTO_STAGES = [
  'Finding suitable templates…',
  'Comparing photo capacity…',
  'Selecting the best blueprint…',
  'Placing your photos…',
  'Preparing your album…',
  'Opening the builder…',
] as const;
const ROMAN = ['I', 'II', 'III', 'IV'];
const LAST_STEP = STEPS.length - 1; // 3 (Review)

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PHOTOS_PER_PAGE = 2; // rough estimate for "≈ pages"

// ── Album period (Task: date UX) ────────────────────────────────────────────
// Native date inputs give YYYY-MM-DD. We compose a single human-readable string and
// store it in the EXISTING albums.travel_dates text column (no schema change). One date
// → that date; both → a range. Backward-compatible: old free-text values still display.
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function composePeriod(from: string, to: string): string {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return formatDate(from);
  if (to) return formatDate(to);
  return '';
}

/**
 * Album Creation wizard — a four-step narrative on top of the EXISTING backend:
 *   Begin → Format → Memories (upload) → Review.
 * Begin/Format collect the album; the draft is created via createAlbumDraft on entering
 * Memories so the existing Uploader can upload into it; Review opens the existing builder
 * (optionally after a deterministic "Build it for me" auto-layout). No AI.
 */
type CoverTemplateOption = { id: string; name: string; previewUrl: string | null };
export type WizardBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isDefault: boolean;
  isNew: boolean;
  breakdown: { label: string; count: number }[];
  thumbUrl: string | null;
};

export default function CreateWizard({
  products,
  covers,
  coverTemplates = [],
  templates = [],
  blueprints = [],
}: {
  products: Product[];
  covers: CoverOption[];
  /** Active builder-JSON cover DESIGN templates (0040) — a fully-editable starting point. */
  coverTemplates?: CoverTemplateOption[];
  /** Active layout presets — feed the deterministic auto-layout for varied "Build it for me". */
  templates?: TemplateChoice[];
  /** Active whole-album blueprints (0043) — the auto-select / choose-blueprint strategies. */
  blueprints?: WizardBlueprint[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  // Begin + Format
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [description, setDescription] = useState('');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  // Cover choice is one of three, mutually exclusive:
  //   coverId    → legacy PNG artwork · designId → builder-JSON design template · customCover → blank
  const [coverId, setCoverId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [customCover, setCustomCover] = useState(false);
  const pickArtwork = (id: string) => { setCoverId(id); setDesignId(null); setCustomCover(false); };
  const pickDesign = (id: string) => { setDesignId(id); setCoverId(null); setCustomCover(false); };
  const pickCustom = () => { setCustomCover(true); setCoverId(null); setDesignId(null); };
  const [showDetails, setShowDetails] = useState(!!destination || !!fromDate || !!toDate || !!description);

  // Created album + photos
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [entering, setEntering] = useState(false); // cinematic builder-entry veil

  // Blueprint strategies (0043): busy flag, choose-blueprint picker, and the applied result summary.
  const [bpBusy, setBpBusy] = useState(false);
  const [bpError, setBpError] = useState<string | null>(null);
  const [bpPickerOpen, setBpPickerOpen] = useState(false);
  const [bpResult, setBpResult] = useState<{ name: string; capacity: number; placed: number; unused: number } | null>(null);
  // Auto Create staged loading (Step 5).
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoStage, setAutoStage] = useState(0);
  const [autoConfirm, setAutoConfirm] = useState<WizardBlueprint | null>(null); // "not enough photos" pre-confirm

  const product = products.find((p) => p.id === productId);
  const cap = product ? photoCap(product.pages) : 100;

  // From <= To validation (both optional; only an explicit inverted range is an error).
  const dateError = !!fromDate && !!toDate && fromDate > toDate;
  const travelPeriod = composePeriod(fromDate, toDate);

  // ── Poll for processing photos (reuses GET /api/photos) ──────────────────────
  const onUploaded = useCallback((p: Photo) => setPhotos((prev) => [...prev, p]), []);
  useEffect(() => {
    if (!albumId) return;
    const anyPending = photos.some((p) => p.status === 'pending');
    if (!anyPending && photos.length > 0) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/photos?albumId=${albumId}`);
        if (!res.ok || !active) return;
        const body = (await res.json()) as {
          photos: {
            id: string;
            status: Photo['status'];
            url: string;
            thumbUrl: string;
            takenAt: string | null;
            width?: number | null;
            height?: number | null;
          }[];
        };
        if (!active) return;
        setPhotos((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const r of body.photos) {
            const ex = byId.get(r.id);
            byId.set(r.id, {
              id: r.id,
              filename: ex?.filename ?? 'photo',
              edit: ex?.edit ?? null,
              status: r.status,
              url: r.url,
              thumbUrl: r.thumbUrl,
              takenAt: r.takenAt,
              width: r.width ?? null,
              height: r.height ?? null,
            });
          }
          return Array.from(byId.values());
        });
      } catch {
        /* transient */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [albumId, photos]);

  const go = (s: number) => {
    if (s < 0 || s > LAST_STEP) return;
    setStep(s);
    setMaxStep((m) => Math.max(m, s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  // Create the draft album when leaving Format → Memories (once).
  const ensureAlbum = async (): Promise<boolean> => {
    if (albumId) return true;
    setCreating(true);
    setError(null);
    const res = await createAlbumDraft({
      title: title.trim(),
      productId,
      // Exactly one cover source (or neither, for a blank custom cover).
      coverTemplateId: coverId ?? undefined,
      coverDesignTemplateId: designId ?? undefined,
      destination,
      travelDates: travelPeriod,
      description,
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setAlbumId(res.id);
    return true;
  };

  const next = async () => {
    if (step === 1) {
      const ok = await ensureAlbum();
      if (!ok) return;
      go(2);
      return;
    }
    if (step === LAST_STEP) {
      // Cinematic builder-entry veil, then hand off to the existing builder.
      if (!albumId) return;
      setEntering(true);
      setTimeout(() => router.push(`/albums/${albumId}/build`), 750);
      return;
    }
    go(step + 1);
  };

  // A cover choice is required at Format: a PNG artwork, a design template, or an explicit blank.
  const hasCoverChoice = !!coverId || !!designId || customCover;
  const canContinue = (() => {
    if (step === 0) return title.trim().length > 0 && !dateError;
    if (step === 1) return !!productId && hasCoverChoice;
    return true;
  })();

  const ready = photos.filter((p) => p.status === 'ready');
  const pending = photos.filter((p) => p.status === 'pending');
  const estPages = Math.max(0, Math.round(photos.length / PHOTOS_PER_PAGE));
  const locked = !!albumId; // Begin/Format are fixed once the album is created

  // "Build it for me" — deterministic engine → preview → Confirm persists via the
  // existing saveLayout, then the cinematic veil launches the existing builder. Active
  // templates (when present) give the layout varied, geometry-driven overlay slots.
  const enginePhotos: EnginePhoto[] = ready.map((p) => ({ id: p.id, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt }));

  // ── Blueprint strategies (Options 1 & 2) ─────────────────────────────────────
  const matchingBlueprints = blueprints
    .filter((b) => !!product && b.pageCount === product.pages)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.featured) - Number(a.featured) || Number(b.popular) - Number(a.popular));

  const launchBuilder = () => {
    if (!albumId) return;
    setEntering(true);
    setTimeout(() => router.push(`/albums/${albumId}/build`), 750);
  };

  // Option 2 — apply a chosen blueprint (optionally auto-placing photos).
  const runApplyBlueprint = async (bpId: string, autoPlace: boolean) => {
    if (!albumId) return;
    setBpBusy(true);
    setBpError(null);
    const res = await applyBlueprintToAlbum({ albumId, blueprintId: bpId, autoPlace });
    setBpBusy(false);
    if (!res.ok) return setBpError(res.error);
    if (autoPlace) {
      const name = matchingBlueprints.find((b) => b.id === bpId)?.name ?? 'Blueprint';
      setBpPickerOpen(false);
      setBpResult({ name, capacity: res.capacity, placed: res.placed, unused: res.unused });
    } else {
      launchBuilder();
    }
  };

  // The blueprint Auto Create WILL use: the admin's default for this size, else the closest
  // capacity (matches the server's deterministic choice). Null when no blueprints exist for the size.
  const autoTarget: WizardBlueprint | null = matchingBlueprints.length
    ? matchingBlueprints.find((b) => b.isDefault) ??
      matchingBlueprints.reduce(
        (best, b) => (Math.abs(b.slotCount - ready.length) < Math.abs(best.slotCount - ready.length) ? b : best),
        matchingBlueprints[0],
      )
    : null;

  // Auto Create entry (Step 5) — gate on "not enough photos" (uploaded < capacity), then proceed.
  const runAutoCreate = () => {
    if (!albumId || !product) return;
    if (autoTarget && ready.length < autoTarget.slotCount) {
      setAutoConfirm(autoTarget); // show Upload More / Continue Anyway
      return;
    }
    proceedAutoCreate();
  };

  // ── Auto Create (Step 5) — staged "beautiful loading", then blueprint auto-select (or, if no
  // matching blueprints exist, the deterministic auto-layout). Always ends in the builder. ───────
  const proceedAutoCreate = async () => {
    if (!albumId || !product) return;
    setBpError(null);
    setAutoConfirm(null);
    setAutoStage(0);
    setAutoCreating(true);
    // Advance the visible stages on a gentle cadence while the real work runs underneath.
    const timer = setInterval(() => setAutoStage((s: number) => Math.min(s + 1, AUTO_STAGES.length - 2)), 700);
    const startedAt = Date.now();

    let ok = false;
    let errMsg: string | null = null;
    try {
      if (matchingBlueprints.length > 0) {
        const res = await autoSelectAndApplyBlueprint({ albumId });
        ok = res.ok;
        if (!res.ok) errMsg = res.error;
      } else {
        // Graceful fallback: no blueprint for this size → deterministic auto-layout.
        const blocks = autoLayout(enginePhotos, product.pages, 0, templates);
        const res = await saveLayout({ albumId, blocks: serializeBlocks(blocks) });
        ok = res.ok;
        if (!res.ok) errMsg = res.error;
      }
    } catch {
      errMsg = 'Something went wrong. Please try again.';
    }
    clearInterval(timer);

    // Ensure the loader is on-screen at least ~2.6s so it never flashes.
    const wait = Math.max(0, 2600 - (Date.now() - startedAt));
    await new Promise((r) => setTimeout(r, wait));
    if (!ok) {
      setAutoCreating(false);
      setBpError(errMsg ?? 'Could not auto-create your album.');
      return;
    }
    setAutoStage(AUTO_STAGES.length - 1);
    setTimeout(() => router.push(`/albums/${albumId}/build`), 500);
  };

  const featuredCount = matchingBlueprints.filter((b) => b.featured || b.pinned).length;
  const categoryCount = new Set(matchingBlueprints.map((b) => b.category)).size;

  const continueLabel = ['Continue', 'Continue', 'Continue', 'Open the builder'][step];

  return (
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      {/* PROGRESS HEADER — sticks just below the global app header (h-14). */}
      <header className="sticky top-14 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
        <span className="inline-flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
            <Sprig className="h-[15px] w-[15px]" />
          </span>
          <span className="font-display text-[15px] font-semibold">Malnad Stories</span>
        </span>
        <ol className="hidden items-center gap-5 md:flex">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => i <= maxStep && go(i)}
                  disabled={i > maxStep}
                  className="flex items-center gap-2 disabled:cursor-default"
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-semibold ${
                      active || done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : ROMAN[i]}
                  </span>
                  <span className={`text-xs ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={() => router.push(albumId ? `/albums/${albumId}/build` : '/dashboard')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Save &amp; exit
        </button>
      </header>

      {/* MAIN */}
      <main className="flex-1 px-5 sm:px-8">
        <div className="animate-rise mx-auto w-full max-w-2xl py-12">
          {/* STEP 0 — BEGIN */}
          {step === 0 && (
            <div className="space-y-7">
              <Eyebrow chapter="I" label="Begin" />
              <h1 className="font-display text-[2.6rem] font-semibold leading-none tracking-tight">Begin a new story.</h1>
              <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
                Every album starts with a few words. Tell us where you went and what to call it — you can change any of
                this later.
              </p>
              <Field label="The title">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={locked}
                  placeholder="Name your story…"
                  className="h-auto border-0 border-b border-input bg-transparent px-0 py-2 font-display text-2xl font-medium shadow-none focus-visible:border-primary focus-visible:ring-0"
                />
              </Field>
              {showDetails ? (
                <>
                  <Field label="Destination · optional" icon={<MapPin className="h-4 w-4 text-primary/70" />}>
                    <Input value={destination} onChange={(e) => setDestination(e.target.value)} disabled={locked} placeholder="Where to?" maxLength={120} />
                  </Field>
                  {/* Album Period — native date pickers (both optional; From ≤ To). */}
                  <Field label="Album period · optional" icon={<Calendar className="h-4 w-4 text-primary/70" />}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="fromDate" className="text-xs font-normal text-muted-foreground">From</Label>
                        <Input
                          id="fromDate"
                          type="date"
                          value={fromDate}
                          max={toDate || undefined}
                          onChange={(e) => setFromDate(e.target.value)}
                          disabled={locked}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="toDate" className="text-xs font-normal text-muted-foreground">To</Label>
                        <Input
                          id="toDate"
                          type="date"
                          value={toDate}
                          min={fromDate || undefined}
                          onChange={(e) => setToDate(e.target.value)}
                          disabled={locked}
                        />
                      </div>
                    </div>
                    {dateError && <p className="text-xs text-destructive">The “From” date must be on or before the “To” date.</p>}
                  </Field>
                  <Field label="A few words · optional">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={locked}
                      rows={2}
                      maxLength={500}
                      placeholder="What made this trip worth keeping?"
                      className="flex w-full rounded-lg border border-input bg-background px-3 py-2 font-display text-lg italic text-foreground shadow-xs outline-none placeholder:not-italic placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
                    />
                  </Field>
                </>
              ) : (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDetails(true)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    + Add trip details (optional)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 1 — FORMAT */}
          {step === 1 && (
            <div className="space-y-7">
              <Eyebrow chapter="II" label="Format" center />
              <div className="text-center">
                <h1 className="font-display text-[2.4rem] font-semibold leading-none tracking-tight">Choose its form.</h1>
                <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                  Three sizes, each a real book you’ll hold. Pick how much of the journey you want to keep.
                </p>
              </div>
              <div className="flex flex-wrap items-end justify-center gap-6 sm:gap-10">
                {products.map((p) => {
                  const selected = productId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => !locked && setProductId(p.id)}
                      disabled={locked}
                      className={`group flex flex-col items-center ${locked ? 'opacity-60' : ''}`}
                    >
                      <span className="relative flex h-[230px] items-end">
                        <Book
                          title={title || 'Your story'}
                          size="md"
                          tilt={false}
                          thickness={Math.max(10, Math.round(p.pages / 1.6))}
                        />
                        {selected && (
                          <span className="absolute -top-2 right-4 grid h-7 w-7 place-items-center rounded-full bg-gold text-background shadow-[0_6px_16px_rgb(160_129_63/0.4)]">
                            <Check className="h-4 w-4" />
                          </span>
                        )}
                      </span>
                      <span className="mt-5 font-display text-2xl font-medium text-primary">{p.name}</span>
                      <span
                        className={`mt-1 text-xs uppercase tracking-[0.1em] ${selected ? 'text-gold' : 'text-muted-foreground'}`}
                      >
                        {p.pages} pages
                      </span>
                      <span className="mt-3 border-t border-border pt-3 font-display text-lg text-primary">
                        {inr(Number(p.basePrice))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-center font-display text-sm italic text-muted-foreground">
                Pages and cover are bound in this size. Layouts and photos remain fully flexible while building.
              </p>
              {/* Cover templates — full designs, fully editable after you pick one. */}
              {coverTemplates.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Cover templates · a designed starting point you can fully edit
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {coverTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => !locked && pickDesign(t.id)}
                        disabled={locked}
                        className={`overflow-hidden rounded-xl border bg-muted text-left transition-all ${
                          designId === t.id ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-ring'
                        } ${locked ? 'opacity-60' : ''}`}
                      >
                        <div className="relative aspect-[3/4] w-full">
                          {t.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.previewUrl} alt={t.name} className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">{t.name}</span>
                          )}
                        </div>
                        <span className="block truncate px-2 py-1.5 text-xs font-medium">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Legacy uploaded-artwork covers (kept for back-compat). */}
              {covers.length > 0 && (
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cover artwork</p>
                  <div className="grid grid-cols-3 gap-3">
                    {covers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => !locked && pickArtwork(c.id)}
                        disabled={locked}
                        className={`overflow-hidden rounded-xl border bg-muted text-left transition-all ${
                          coverId === c.id ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-ring'
                        } ${locked ? 'opacity-60' : ''}`}
                      >
                        <div className="relative aspect-[3/4] w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.thumbUrl} alt={c.name} className="absolute inset-0 h-full w-full object-cover" />
                        </div>
                        <span className="block truncate px-2 py-1.5 text-xs font-medium">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom (blank) cover — design it from scratch in the builder. */}
              <button
                type="button"
                onClick={() => !locked && pickCustom()}
                disabled={locked}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${
                  customCover ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-ring'
                } ${locked ? 'opacity-60' : ''}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
                  <ImageIcon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium">Custom cover</span>
                  <span className="block text-xs text-muted-foreground">Start from a blank cover and design it yourself.</span>
                </span>
              </button>
              {locked && (
                <p className="text-center text-xs text-muted-foreground">
                  Your album is created — size &amp; cover are set. You can adjust photos and layout in the builder.
                </p>
              )}
            </div>
          )}

          {/* STEP 2 — MEMORIES (upload) */}
          {step === 2 && albumId && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Eyebrow chapter="III" label="Memories" />
                  <h1 className="mt-3 font-display text-[2.2rem] font-semibold leading-none tracking-tight">
                    Gather your photographs.
                  </h1>
                </div>
                {photos.length > 0 && (
                  <div className="text-right">
                    <div className="font-display text-3xl font-semibold tabular-nums">
                      {photos.length}
                      <span className="text-base text-muted-foreground/60"> / {cap}</span>
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">photos used · ≈ {estPages} pages</div>
                  </div>
                )}
              </div>
              <Uploader albumId={albumId} remaining={Math.max(0, cap - photos.length)} onUploaded={onUploaded} />
              {photos.length > 0 && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {pending.length > 0 ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing {pending.length} of {photos.length}…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> All {photos.length} added · {cap - photos.length} left
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                    {photos.slice(0, 24).map((p) => (
                      <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                        {p.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbUrl} alt={p.filename} className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3 — REVIEW */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="text-center">
                <Eyebrow chapter="IV" label="Create" center />
                <h1 className="mt-3 font-display text-[2.4rem] font-semibold leading-none tracking-tight">
                  Choose how to build your album.
                </h1>
                <p className="mx-auto mt-3 max-w-lg text-[15px] text-muted-foreground">
                  Three ways to turn your {ready.length} photo{ready.length === 1 ? '' : 's'} into a finished book — pick the
                  one that suits you. You can always edit everything in the builder afterwards.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr]">
                <div className="rounded-2xl border bg-card p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Album</p>
                  <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight">{title || 'Untitled'}</h2>
                  <div className="mt-4 space-y-2 text-sm">
                    {destination && (
                      <p className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-primary/70" /> {destination}
                      </p>
                    )}
                    {travelPeriod && (
                      <p className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary/70" /> {travelPeriod}
                      </p>
                    )}
                  </div>
                  {description && (
                    <p className="mt-4 border-t pt-4 font-display text-lg italic text-muted-foreground">“{description}”</p>
                  )}
                </div>
                <div className="flex flex-col justify-between rounded-2xl bg-primary p-6 text-primary-foreground">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/70">
                    The numbers
                  </p>
                  <div className="mt-4 space-y-3">
                    <Stat label="Photographs" value={photos.length} />
                    <Stat label="Estimated pages" value={`≈ ${estPages}`} />
                    <Stat label="Format" value={`${product?.pages ?? ''} pages`} />
                  </div>
                </div>
              </div>

              {/* CHOOSE HOW TO BUILD — three intentional cards (Step 1). */}
              <div className="grid gap-4 md:grid-cols-3">
                {/* 1 · Auto Create */}
                <MethodCard
                  emoji="🎲"
                  Icon={Dices}
                  title="Auto Create"
                  desc={
                    autoTarget
                      ? `We’ll build your album from the “${autoTarget.name}” blueprint and place your photos automatically. A beautiful album in seconds.`
                      : 'We’ll arrange your photos into a full album automatically. A beautiful album in seconds.'
                  }
                  stats={
                    autoTarget
                      ? [
                          { label: 'Blueprint', value: autoTarget.name },
                          { label: 'Capacity', value: `${autoTarget.slotCount}` },
                          { label: 'Your photos', value: `${ready.length}` },
                        ]
                      : [
                          { label: 'Pages', value: `${product?.pages ?? ''}` },
                          { label: 'Photos', value: `${ready.length}` },
                          { label: 'Ready in', value: '~ seconds' },
                        ]
                  }
                  cta="Auto Create Album"
                  onClick={runAutoCreate}
                  disabled={!albumId || autoCreating}
                  primary
                />
                {/* 2 · Choose a Template */}
                <MethodCard
                  emoji="📚"
                  Icon={LayoutTemplate}
                  title="Choose a Template"
                  desc="Browse professionally designed album blueprints and pick the style you like — then place your photos."
                  stats={
                    matchingBlueprints.length > 0
                      ? [
                          { label: 'Templates', value: `${matchingBlueprints.length}` },
                          { label: 'Categories', value: `${categoryCount}` },
                          { label: 'Featured', value: `${featuredCount}` },
                        ]
                      : [{ label: '', value: 'No templates for this size yet' }]
                  }
                  cta="Browse Templates"
                  onClick={() => setBpPickerOpen(true)}
                  disabled={matchingBlueprints.length === 0 || autoCreating}
                />
                {/* 3 · Design My Own */}
                <MethodCard
                  emoji="✨"
                  Icon={Sparkles}
                  title="Design My Own"
                  desc="Start with a blank album and design every page exactly how you want, with full control in the builder."
                  stats={[{ label: '', value: 'Full creative control' }]}
                  cta="Open Builder"
                  onClick={launchBuilder}
                  disabled={!albumId || autoCreating}
                />
              </div>
              {bpError && <p className="text-center text-sm text-destructive">{bpError}</p>}
            </div>
          )}

          {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
        </div>
      </main>

      {/* FOOTER NAV */}
      <footer className="sticky bottom-0 z-20 flex h-20 items-center justify-between border-t bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
        <div className="min-w-[120px]">
          {step > 0 && (
            <Button variant="ghost" onClick={() => go(step - 1)} disabled={creating}>
              <ArrowLeft /> Back
            </Button>
          )}
        </div>
        <div className="hidden text-xs text-muted-foreground sm:block">
          {step === 2 && photos.length > 0 ? `${photos.length} of ${cap} photos · ≈ ${estPages} pages` : ''}
        </div>
        <div className="flex min-w-[120px] justify-end">
          {/* The final "Create" step's actions live in the three method cards — no competing footer CTA. */}
          {step < LAST_STEP && (
            <Button onClick={next} disabled={!canContinue || creating} className={LUX_PRIMARY}>
              {creating ? <Loader2 className="animate-spin" /> : null}
              {continueLabel}
              {!creating && <ArrowRight />}
            </Button>
          )}
        </div>
      </footer>

      {/* Premium template browser (Steps 2 & 3) */}
      {bpPickerOpen && (
        <BlueprintPicker
          blueprints={matchingBlueprints}
          uploaded={ready.length}
          busy={bpBusy}
          onApply={runApplyBlueprint}
          onClose={() => setBpPickerOpen(false)}
        />
      )}

      {/* Blueprint applied — summary + launch (Options 1 & 2) */}
      {bpResult && (
        <div className="animate-fade-in fixed inset-0 z-[115] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border bg-background p-6 text-center shadow-elevated">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/[0.08] text-primary ring-1 ring-primary/15">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">Your album is arranged</h2>
            <p className="mt-1 text-sm text-muted-foreground">{bpResult.name}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Capacity', value: bpResult.capacity },
                { label: 'Placed', value: bpResult.placed },
                { label: 'Unused', value: bpResult.unused },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-card px-1.5 py-2">
                  <div className="text-lg font-semibold tabular-nums text-foreground">{s.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
            <Button onClick={launchBuilder} className={`mt-5 w-full ${LUX_PRIMARY}`}>
              Open my album <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {/* AUTO CREATE — "not enough photos" pre-confirm (never fails) */}
      {autoConfirm && (
        <div className="animate-fade-in fixed inset-0 z-[118] flex items-center justify-center bg-black/60 p-4" onClick={() => setAutoConfirm(null)}>
          <div className="animate-scale-in w-full max-w-md rounded-2xl border bg-background p-6 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl font-semibold tracking-tight">A few more photos will fill it out</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The <span className="font-medium text-foreground">{autoConfirm.name}</span> blueprint holds{' '}
              {autoConfirm.slotCount} photos. You’ve uploaded {ready.length}. You can add more, or continue now — the extra
              frames will simply stay empty for you to fill later.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                { k: 'Capacity', v: autoConfirm.slotCount },
                { k: 'Uploaded', v: ready.length },
                { k: 'Empty frames', v: Math.max(0, autoConfirm.slotCount - ready.length) },
                { k: 'Unused', v: Math.max(0, ready.length - autoConfirm.slotCount) },
              ].map((s) => (
                <div key={s.k} className="rounded-lg border bg-card px-1.5 py-2">
                  <div className="text-base font-semibold tabular-nums">{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.k}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="outline" onClick={() => { setAutoConfirm(null); go(2); }}>
                <ImageIcon /> Upload more photos
              </Button>
              <Button onClick={proceedAutoCreate} className={LUX_PRIMARY}>
                Continue anyway <ArrowRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* AUTO CREATE — staged loading (Step 5) */}
      {autoCreating && (
        <div className="animate-fade-in fixed inset-0 z-[125] flex flex-col items-center justify-center bg-[linear-gradient(180deg,hsl(156_36%_12%),hsl(156_36%_8%))] px-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-gold ring-1 ring-white/10">
            <Dices className="h-7 w-7 animate-pulse" />
          </span>
          <h2 className="mt-6 font-display text-[clamp(1.9rem,5vw,2.6rem)] font-normal leading-tight text-primary-foreground">Creating your album</h2>
          <ol className="mt-7 space-y-2.5 text-left">
            {AUTO_STAGES.map((s, i) => (
              <li key={s} className={`flex items-center gap-3 text-[15px] transition-all duration-300 ${i <= autoStage ? 'text-primary-foreground' : 'text-primary-foreground/30'}`}>
                <span className={`grid h-5 w-5 flex-none place-items-center rounded-full transition-colors ${i < autoStage ? 'bg-gold text-background' : i === autoStage ? 'bg-white/15 text-gold' : 'bg-white/5'}`}>
                  {i < autoStage ? <Check className="h-3 w-3" /> : i === autoStage ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* CINEMATIC BUILDER-ENTRY VEIL */}
      {entering && (
        <div
          onClick={() => router.push(`/albums/${albumId}/build`)}
          className="animate-fade-in fixed inset-0 z-[120] flex cursor-pointer flex-col items-center justify-center bg-[linear-gradient(180deg,hsl(156_36%_12%),hsl(156_36%_8%))] text-center"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-gold/80">Opening your album</p>
          <h2 className="animate-rise mt-6 max-w-[18ch] font-display text-[clamp(2.5rem,7vw,4rem)] font-normal leading-tight text-primary-foreground">
            {title || 'Your story'}
          </h2>
          <span className="mt-7 h-px w-60 bg-[linear-gradient(90deg,transparent,hsl(var(--gold)/0.6),transparent)]" />
          <div className="mt-8 flex items-center gap-3 text-sm text-primary-foreground/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold/80" /> Preparing your spreads…
          </div>
          <p className="absolute bottom-6 text-[10px] uppercase tracking-widest text-primary-foreground/30">Click anywhere to skip</p>
        </div>
      )}
    </div>
  );
}

function Eyebrow({ chapter, label, center }: { chapter: string; label: string; center?: boolean }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/70 ${center ? 'text-center' : ''}`}>
      Chapter {chapter} · {label}
    </p>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-primary-foreground/70">{label}</span>
      <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** One of the three "Choose how to build" method cards (Step 1). Premium, with a single clear CTA. */
function MethodCard({
  emoji,
  Icon,
  title,
  desc,
  stats,
  cta,
  onClick,
  disabled,
  primary = false,
}: {
  emoji: string;
  Icon: typeof ArrowRight;
  title: string;
  desc: string;
  stats: { label: string; value: string }[];
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <div
      className={`group flex flex-col rounded-2xl border p-5 text-left transition-all duration-200 ease-glide ${
        disabled ? 'opacity-60' : 'hover:-translate-y-1 hover:shadow-elevated'
      } ${primary ? 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/10' : 'bg-card'}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-primary/[0.07] text-xl ring-1 ring-primary/15" aria-hidden>
          {emoji}
        </span>
        <div>
          <h3 className="font-display text-[18px] font-semibold tracking-tight">{title}</h3>
          {primary && <span className="text-[11px] font-medium uppercase tracking-wide text-primary/80">Fastest</span>}
        </div>
      </div>
      <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
      <div className="mt-4 space-y-1 border-t pt-3">
        {stats.map((s, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            {s.label ? <span className="text-muted-foreground">{s.label}</span> : <span />}
            <span className={`font-medium tabular-nums ${s.label ? 'text-foreground' : 'text-muted-foreground'}`}>{s.value}</span>
          </div>
        ))}
      </div>
      <Button onClick={onClick} disabled={disabled} className={`mt-4 w-full ${primary ? LUX_PRIMARY : ''}`} variant={primary ? 'default' : 'outline'}>
        <Icon /> {cta}
      </Button>
    </div>
  );
}
