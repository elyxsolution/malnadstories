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
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY, Sprig } from '@/components/brand';
import { Wand2 } from 'lucide-react';
import { createAlbumDraft } from '@/lib/actions/albums';
import { saveLayout } from '@/lib/actions/builder';
import { photoCap, type Block } from '@/lib/builder/model';
import { autoLayout, summarizePlan, serializeBlocks, type EnginePhoto } from '@/lib/builder/auto-layout';
import Book from '@/components/book';
import Uploader, { type Photo } from '../[id]/build/_uploader';
import Proposal from '../[id]/build/_proposal';
import type { CoverOption } from '@/lib/covers';

type Grouping = 'date' | 'place' | 'segment';
const GROUP_TABS: { key: Grouping; label: string }[] = [
  { key: 'date', label: 'By date' },
  { key: 'place', label: 'By place' },
  { key: 'segment', label: 'By chapter' },
];

type Product = { id: string; name: string; pages: number; basePrice: string };

const STEPS = ['Begin', 'Format', 'Memories', 'Moments', 'Story', 'Review'] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PHOTOS_PER_PAGE = 2; // rough estimate for "≈ pages"

/**
 * Album Creation wizard (Design Completion Phase 1) — the prototype's 6-step narrative
 * on top of the EXISTING backend. Begin/Format collect the album; the draft is created
 * via createAlbumDraft (the createAlbum flow, returning an id) on entering Memories so
 * the existing Uploader can upload into it; Moments/Story are advisory, deterministic
 * (grouped by EXIF date — no AI service); Review opens the existing builder.
 */
export default function CreateWizard({ products, covers }: { products: Product[]; covers: CoverOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);

  // Begin + Format
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [travelDates, setTravelDates] = useState('');
  const [description, setDescription] = useState('');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [coverId, setCoverId] = useState<string | null>(null);

  // Created album + photos
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Story (advisory, not persisted — there is no chapters entity)
  const [chapters, setChapters] = useState<string[]>(['Arrival', 'Exploration', 'Highlights', 'Final Memories']);
  const [grouping, setGrouping] = useState<Grouping>('date');
  const [entering, setEntering] = useState(false); // cinematic builder-entry veil

  // "Build it for me" proposal (deterministic engine; preview before any persistence).
  const [proposal, setProposal] = useState<{ blocks: Block[]; strategy: number; summary: ReturnType<typeof summarizePlan> } | null>(null);
  const [generating, setGenerating] = useState(false);

  const product = products.find((p) => p.id === productId);
  const cap = product ? photoCap(product.pages) : 100;

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
    if (s < 0 || s > 5) return;
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
      coverTemplateId: coverId,
      destination,
      travelDates,
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
    if (step === 5) {
      // Cinematic builder-entry veil, then hand off to the existing builder.
      if (!albumId) return;
      setEntering(true);
      setTimeout(() => router.push(`/albums/${albumId}/build`), 1700);
      return;
    }
    go(step + 1);
  };

  const canContinue = (() => {
    if (step === 0) return title.trim().length > 0;
    if (step === 1) return !!productId && !!coverId;
    return true;
  })();

  const ready = photos.filter((p) => p.status === 'ready');
  const pending = photos.filter((p) => p.status === 'pending');
  const estPages = Math.max(0, Math.round(photos.length / PHOTOS_PER_PAGE));
  const locked = !!albumId; // Begin/Format are fixed once the album is created

  // "Build it for me" — deterministic engine → preview → Confirm persists via the
  // existing saveLayout, then the cinematic veil launches the existing builder.
  const enginePhotos: EnginePhoto[] = ready.map((p) => ({ id: p.id, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt }));
  const photoMap = new Map(photos.map((p) => [p.id, p]));
  const selectedCover = covers.find((c) => c.id === coverId) ?? null;

  const buildForMe = (strategy = 0) => {
    if (!product) return;
    const blocks = autoLayout(enginePhotos, product.pages, strategy);
    setProposal({ blocks, strategy, summary: summarizePlan(blocks, enginePhotos.length) });
  };
  const acceptWiz = async () => {
    if (!albumId || !proposal) return;
    setGenerating(true);
    const res = await saveLayout({ albumId, blocks: serializeBlocks(proposal.blocks) });
    setGenerating(false);
    if (!res.ok) {
      setError(res.error);
      setProposal(null);
      return;
    }
    setProposal(null);
    setEntering(true);
    setTimeout(() => router.push(`/albums/${albumId}/build`), 1700);
  };

  const continueLabel = ['Continue', 'Continue', 'Organize my photos', 'Looks right', 'Use this structure', 'Open the builder'][step];

  return (
    <div className="brand-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      {/* PROGRESS HEADER — sticks just below the global app header (h-14). */}
      <header className="sticky top-14 z-20 flex h-16 items-center justify-between border-b bg-background/85 px-5 backdrop-blur-md sm:px-8">
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
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Destination · optional" icon={<MapPin className="h-4 w-4 text-primary/70" />}>
                  <Input value={destination} onChange={(e) => setDestination(e.target.value)} disabled={locked} placeholder="Where to?" maxLength={120} />
                </Field>
                <Field label="Travel dates · optional" icon={<Calendar className="h-4 w-4 text-primary/70" />}>
                  <Input value={travelDates} onChange={(e) => setTravelDates(e.target.value)} disabled={locked} placeholder="When?" maxLength={60} />
                </Field>
              </div>
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
                          <span className="absolute -top-2 right-4 grid h-7 w-7 place-items-center rounded-full bg-gold text-[#fbf8f1] shadow-[0_6px_16px_rgb(160_129_63/0.4)]">
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
              <p className="text-center font-display text-base italic text-muted-foreground">
                You can add or remove pages any time while building.
              </p>
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cover design</p>
                {covers.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No cover designs are available yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {covers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => !locked && setCoverId(c.id)}
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
                )}
              </div>
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
                    <div className="font-display text-3xl font-semibold tabular-nums">{photos.length}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">photos · ≈ {estPages} pages</div>
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
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> All {photos.length} added
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

          {/* STEP 3 — MOMENTS (deterministic grouping; no AI) */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Eyebrow chapter="IV" label="Moments" />
                  <h1 className="mt-3 font-display text-[2.2rem] font-semibold leading-none tracking-tight">
                    Your trip, in moments.
                  </h1>
                </div>
                <div className="flex border border-input bg-card">
                  {GROUP_TABS.map((g, i) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setGrouping(g.key)}
                      className={`px-4 py-2.5 text-[13px] transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        grouping === g.key ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
                We’ve gathered your {ready.length} ready photo{ready.length === 1 ? '' : 's'} into moments. Group them
                whichever way the trip felt — you’ll arrange them freely in the builder.
              </p>
              <MomentGrid photos={ready} grouping={grouping} />
            </div>
          )}

          {/* STEP 4 — STORY (advisory, not persisted) */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="text-center">
                <Eyebrow chapter="V" label="Story" center />
                <h1 className="mt-3 font-display text-[2.2rem] font-semibold leading-none tracking-tight">
                  A shape for your story.
                </h1>
                <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                  A suggested structure to start from — rename these chapters, or keep them. The final arrangement is
                  yours in the builder.
                </p>
              </div>
              {/* Vertical timeline */}
              <div className="relative">
                <span aria-hidden className="absolute bottom-6 left-[23px] top-6 w-px bg-border" />
                <div className="flex flex-col gap-4">
                  {chapters.map((c, i) => {
                    const per = Math.ceil(Math.max(1, ready.length) / chapters.length);
                    const strip = ready.slice(i * per, i * per + 3);
                    const rest = Math.max(0, ready.slice(i * per, (i + 1) * per).length - 3);
                    return (
                      <div key={i} className="relative flex items-start gap-5">
                        <span className="z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary font-display text-xl text-primary-foreground shadow-[0_0_0_6px_hsl(var(--background))]">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="flex-1 border border-border bg-card p-5">
                          <Input
                            value={c}
                            onChange={(e) => setChapters((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                            className="border-0 bg-transparent px-0 font-display text-2xl font-medium text-primary shadow-none focus-visible:ring-0"
                          />
                          <div className="mt-3 flex gap-1.5">
                            {strip.map((p) => (
                              <span key={p.id} className="h-10 w-14 overflow-hidden rounded-[2px] bg-muted">
                                {p.thumbUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                                )}
                              </span>
                            ))}
                            {rest > 0 && (
                              <span className="grid h-10 w-14 place-items-center rounded-[2px] bg-secondary font-mono text-[11px] text-muted-foreground">
                                +{rest}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChapters((prev) => [...prev].reverse())}
                >
                  <Sparkles /> Suggest a different structure
                </Button>
              </div>
              <p className="flex items-center justify-center gap-2 text-center font-display text-sm italic text-muted-foreground">
                <Sparkles className="h-4 w-4 not-italic text-gold" /> A suggestion — the final say is always yours.
              </p>
            </div>
          )}

          {/* STEP 5 — REVIEW */}
          {step === 5 && (
            <div className="space-y-6">
              <div className="text-center">
                <Eyebrow chapter="VI" label="Review" center />
                <h1 className="mt-3 font-display text-[2.4rem] font-semibold leading-none tracking-tight">
                  Ready to begin building.
                </h1>
                <p className="mt-3 text-[15px] text-muted-foreground">One last look before you step into the builder.</p>
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
                    {travelDates && (
                      <p className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary/70" /> {travelDates}
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

              {/* Build it for me — deterministic auto-layout, previewed before it saves. */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/30 bg-gold/[0.05] p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
                    <Wand2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-display text-[17px] font-semibold tracking-tight">Build it for me</p>
                    <p className="text-[13px] text-muted-foreground">
                      I’ll arrange your {ready.length} photo{ready.length === 1 ? '' : 's'} into a full album — you preview
                      it before anything is saved.
                    </p>
                  </div>
                </div>
                <Button onClick={() => buildForMe(0)} disabled={ready.length === 0 || !albumId} className={LUX_PRIMARY}>
                  <Wand2 /> Generate my album
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
        </div>
      </main>

      {/* FOOTER NAV */}
      <footer className="sticky bottom-0 z-20 flex h-20 items-center justify-between border-t bg-background/90 px-5 backdrop-blur-md sm:px-8">
        <div className="min-w-[120px]">
          {step > 0 && (
            <Button variant="ghost" onClick={() => go(step - 1)} disabled={creating}>
              <ArrowLeft /> Back
            </Button>
          )}
        </div>
        <div className="hidden text-xs text-muted-foreground sm:block">
          {step === 2 && photos.length > 0 ? `${photos.length} photos · ≈ ${estPages} pages` : ''}
        </div>
        <div className="flex min-w-[120px] justify-end">
          <Button onClick={next} disabled={!canContinue || creating} className={LUX_PRIMARY}>
            {creating ? <Loader2 className="animate-spin" /> : null}
            {continueLabel}
            {!creating && (step === 5 ? <ImageIcon /> : <ArrowRight />)}
          </Button>
        </div>
      </footer>

      {/* CINEMATIC BUILDER-ENTRY VEIL */}
      {proposal && (
        <Proposal
          title="Your generated album"
          blocks={proposal.blocks}
          photoMap={photoMap}
          cover={selectedCover}
          summary={proposal.summary}
          canRegenerate
          busy={generating}
          acceptLabel="Open my album"
          onAccept={acceptWiz}
          onRegenerate={() => buildForMe(proposal.strategy + 1)}
          onCancel={() => setProposal(null)}
        />
      )}

      {entering && (
        <div className="animate-fade-in fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#122019] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[#b89a5c]">Opening your album</p>
          <h2 className="animate-rise mt-6 max-w-[18ch] font-display text-[clamp(2.5rem,7vw,4rem)] font-normal leading-tight text-[#f5efe3]">
            {title || 'Your story'}
          </h2>
          <span className="mt-7 h-px w-60 bg-[linear-gradient(90deg,transparent,#b89a5c,transparent)]" />
          <div className="mt-8 flex items-center gap-3 text-sm text-[#a9bdb0]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ecd9ad]" /> Preparing your spreads…
          </div>
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

function MomentGrid({ photos, grouping }: { photos: Photo[]; grouping: Grouping }) {
  // All deterministic — no AI. "date" groups by EXIF capture date; "place"/"segment"
  // split the chronological run into even buckets (no place data exists, so this is a
  // visual suggestion the customer refines in the builder).
  const ordered = [...photos].sort((a, b) => (a.takenAt ?? '').localeCompare(b.takenAt ?? ''));
  let entries: [string, Photo[]][] = [];

  if (grouping === 'date') {
    const groups = new Map<string, Photo[]>();
    for (const p of ordered) {
      const key = p.takenAt
        ? new Date(p.takenAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Undated';
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }
    entries = Array.from(groups.entries());
  } else {
    const buckets = Math.min(grouping === 'segment' ? 4 : 5, Math.max(1, ordered.length));
    const per = Math.ceil(ordered.length / buckets);
    const noun = grouping === 'segment' ? 'Chapter' : 'Place';
    for (let i = 0; i < buckets; i++) {
      const slice = ordered.slice(i * per, (i + 1) * per);
      if (slice.length) entries.push([`${noun} ${i + 1}`, slice]);
    }
  }

  if (photos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-card/50 p-6 text-sm text-muted-foreground">
        No processed photos yet — add some in the previous step and they’ll group here by day.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(([day, ph], i) => (
        <div key={day} className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid grid-cols-3 gap-0.5 bg-muted">
            {ph.slice(0, 3).map((p) => (
              <div key={p.id} className="relative aspect-square bg-muted">
                {p.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
              </div>
            ))}
          </div>
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-[0.16em] text-primary/70">Moment {i + 1}</p>
            <p className="mt-1 font-display text-lg font-semibold tracking-tight">{day}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{ph.length} photo{ph.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
