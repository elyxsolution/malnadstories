'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, ArrowRight, Trash2, X, AlertTriangle, SearchX } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import Book, { paletteFor } from '@/components/book';
import { albumCoverFace, albumCoverSpine } from '@/components/album-cover';
import type { CoverConfig } from '@/lib/builder/cover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteAlbum } from '@/lib/actions/albums';
import DesignShelf from './_design-shelf';
import type { BlueprintPlacement } from '@/lib/cms/blueprint-placement';

export type LibraryAlbum = {
  id: string;
  title: string;
  size: number;
  status: string;
  updatedAt: string;
  purchase: { orderId: string; status: string; placedAt: string } | null;
  /** The album's persisted cover, already normalized server-side. `null` = never designed one. */
  cover: CoverConfig | null;
  /**
   * The front cover's ARTWORK — a short-lived signed URL for the customer's cover photo, or the
   * chosen template's image, resolved server-side through the canonical priority chain. `null`
   * means the cover is CSS-only (a background, or the default), which the renderer draws itself.
   */
  coverImageUrl: string | null;
};

type Kind = 'draft' | 'ready' | 'ordered' | 'delivered';

const KIND: Record<Kind, { label: string; color: string; bg: string; dot: string }> = {
  draft: { label: 'In progress', color: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground/60' },
  ready: { label: 'Ready to order', color: 'text-primary', bg: 'bg-primary/10', dot: 'bg-primary' },
  ordered: { label: 'Ordered', color: 'text-gold', bg: 'bg-gold/12', dot: 'bg-gold' },
  delivered: { label: 'Delivered', color: 'text-success', bg: 'bg-success/12', dot: 'bg-success' },
};

const kindOf = (a: LibraryAlbum): Kind => {
  if (a.purchase?.status === 'delivered') return 'delivered';
  if (a.purchase) return 'ordered';
  if (a.status === 'submitted') return 'ready';
  return 'draft';
};

const CHIPS: { key: 'all' | Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'In progress' },
  { key: 'ready', label: 'Ready to order' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'delivered', label: 'Delivered' },
];

export default function Library({
  albums,
  stickerUrls = {},
  designs,
}: {
  albums: LibraryAlbum[];
  /** Presigned URLs for stickers placed on any front cover, by sticker id (resolved server-side). */
  stickerUrls?: Record<string, string>;
  /**
   * The CMS-curated design shelf, already resolved by the page. Optional so this component still
   * renders without one, and EMPTY means the shelf is not drawn — never that a default is chosen.
   */
  designs?: BlueprintPlacement;
}) {
  const stickerUrlFor = (id: string) => stickerUrls[id];
  const [greeting, setGreeting] = useState('Welcome back');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('all');
  const [chip, setChip] = useState<'all' | Kind>('all');

  // Time-of-day greeting computed after mount to avoid an SSR/client hour mismatch.
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const years = useMemo(
    () => Array.from(new Set(albums.map((a) => new Date(a.updatedAt).getFullYear().toString()))).sort().reverse(),
    [albums],
  );

  const draft = albums.find((a) => !a.purchase && (a.status === 'draft' || a.status === 'submitted'));

  const filtered = albums.filter((a) => {
    if (year !== 'all' && new Date(a.updatedAt).getFullYear().toString() !== year) return false;
    if (chip !== 'all' && kindOf(a) !== chip) return false;
    const q = search.trim().toLowerCase();
    if (q && !a.title.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-5xl">
        {/* Greeting masthead */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-medium tracking-tight text-primary">
          {greeting}.
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground font-light">
          {albums.length === 0
            ? 'Your shelf is waiting for its first story.'
            : `${albums.length} ${albums.length === 1 ? 'story' : 'stories'} on your shelf${draft ? ' — one still being written.' : '.'}`}
        </p>

        {/*
          ── THE CREATION AREA — ALWAYS PRESENT, IN TWO SHAPES ───────────────────────────────
          It used to render ONLY when a draft existed, which meant the customer with the most to
          gain from it — the one who has never made an album — arrived at a dashboard whose only
          way to begin was a dashed bookend at the end of an empty shelf. The area is now
          unconditional and takes the shape the state deserves:

            · a draft in progress → TWO PANELS OF EQUAL WEIGHT. Resume keeps its forest ground
              and its content; New album sits beside it as a second forest panel, not as the
              dashed white placeholder it used to be.
            · nothing yet         → the SAME panel, full width, which is the whole point of the
              screen at that moment. No empty "resume" card, no placeholder album, no invented
              story count — just the one thing there is to do.

          WHY THE WHITE CARD WENT. "Start a new album" and "carry on with this one" are peers —
          on most visits the new one is the more likely intention — but the row said otherwise:
          a wide filled panel beside a 240px dashed outline reads as an action beside an empty
          slot, and an empty slot is not an invitation. Both are now forest, both fill the row's
          height (the grid stretches them, so their top and bottom edges align by construction),
          and the pair reads as one composition with two doors rather than one action and a gap.

          Both shapes go to `/albums/new`: the same route, the same creation flow, one entry.
        */}
        {draft ? (
          <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            {/* Resume — the left card, unchanged in content and destination. */}
            <div className="flex flex-wrap items-center gap-6 bg-primary px-6 py-6 text-primary-foreground sm:gap-7 sm:px-8">
              <Book
                title={draft.title}
                size="sm"
                thickness={9}
                cover={paletteFor(draft.id)}
                coverContent={albumCoverFace(draft.cover, draft.title, draft.coverImageUrl, stickerUrlFor)}
                spineContent={albumCoverSpine(draft.cover, draft.title)}
              />
              <div className="min-w-[180px] flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-primary-foreground/75">Pick up where you left off</p>
                <p className="mt-1 font-display text-[26px] leading-tight text-primary-foreground">{draft.title}</p>
                <p className="mt-1 text-sm text-primary-foreground/80">{draft.size} pages · {KIND[kindOf(draft)].label}</p>
                <Button
                  render={<Link href={`/albums/${draft.id}/build`} />}
                  variant="secondary"
                  className="mt-4"
                >
                  Resume building <ArrowRight />
                </Button>
              </div>
            </div>

            {/* New album — the second panel, same weight, same route. */}
            <NewAlbumPanel />
          </div>
        ) : (
          /*
            THE FIRST-RUN INVITATION — the SAME panel, given the whole row. One component, two
            widths, so the two states cannot drift into two different-looking front doors.
          */
          <div className="mt-8">
            <NewAlbumPanel full />
          </div>
        )}

        {/*
          THE CURATED DESIGNS, between "what will I make" and "what I have made" — the point in
          the page where the question is still open. Renders nothing at all when an administrator
          has configured nothing; see `_design-shelf.tsx`.
        */}
        {designs && <DesignShelf heading={designs.heading} subheading={designs.subheading} set={designs.set} />}

        {/* Library header + search + filters */}
        <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-medium tracking-tight text-primary">Your stories</h2>
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search destinations…"
                className="h-8 w-[200px] pl-8 pr-3 text-xs bg-card rounded-sm"
              />
            </div>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-8 rounded-sm border border-input bg-card px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-ring"
            >
              <option value="all">All years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {CHIPS.map((c) => {
            const active = chip === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setChip(c.key)}
                className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {/* The shelf */}
        {filtered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center border border-dashed bg-card/40 px-6 py-20 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-4 font-display text-2xl text-primary">No stories match that.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different destination, year, or status.</p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => {
                setSearch('');
                setYear('all');
                setChip('all');
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="mt-9 flex flex-wrap items-end gap-x-10 gap-y-10">
            {filtered.map((a) => (
              <ShelfBook key={a.id} album={a} stickerUrlFor={stickerUrlFor} />
            ))}
            {/* New Story bookend */}
            <Link href="/albums/new" className="group w-[150px] text-center">
              <div className="flex h-[248px] items-end justify-center">
                <div className="flex h-[200px] w-[150px] flex-col items-center justify-center gap-3 border-[1.5px] border-dashed border-input text-muted-foreground transition-all duration-200 group-hover:-translate-y-1.5 group-hover:border-primary group-hover:text-primary">
                  <Plus className="h-6 w-6" />
                  <span className="font-display text-lg">New story</span>
                </div>
              </div>
              <p className="mt-3.5 text-[13px] text-muted-foreground">Begin a new chapter</p>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * NEW ALBUM — the front door, as a panel rather than a placeholder.
 *
 * ONE COMPONENT, TWO WIDTHS. Beside a draft it takes its column; with no albums yet it takes the
 * row. Nothing else differs but the vertical breathing room, so the customer who returns after
 * making their first album meets the same door they came in through.
 *
 * FOREST, NOT DASHED WHITE. `bg-primary-deep` is the existing "leather" end of the palette —
 * the command rail and book spines already use it — so this reads as a sibling of the Resume
 * panel's `bg-primary` rather than as a second, unrelated green. The half-step of depth between
 * the two is the hierarchy: they are peers, and the one carrying content leads. No gradient, no
 * new token, no heavy shadow.
 *
 * THE HAIRLINE IS THE AFFORDANCE. A gold-pale rule at 25% marks the panel as a surface you may
 * press without turning it into a button; it warms on hover, and the ring around the plus warms
 * with it. Everything else about the hover is a 2px lift and a soft drop — the same
 * `ease-premium` language the rest of the product moves in, explicitly stilled under
 * `prefers-reduced-motion` so the panel stops travelling while keeping every state cue.
 *
 * IT IS ONE LINK, so the whole panel is the target — no nested control, one tab stop, one
 * accessible name, and the EXISTING `/albums/new` route behind it.
 */
function NewAlbumPanel({ full = false }: { full?: boolean }) {
  return (
    <Link
      href="/albums/new"
      aria-label="Start a new album"
      className={`group relative flex flex-col items-center justify-center gap-4 overflow-hidden bg-primary-deep px-6 text-center text-primary-foreground shadow-[0_1px_2px_rgb(16_24_20/0.06)] ring-1 ring-inset ring-gold-pale/25 transition-[transform,box-shadow,background-color] duration-300 ease-premium hover:-translate-y-0.5 hover:bg-primary-light hover:shadow-elevated hover:ring-gold-pale/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-pale motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        full ? 'py-16 sm:py-24' : 'py-12 sm:py-10'
      }`}
    >
      <span className="grid h-14 w-14 place-items-center rounded-full ring-1 ring-gold-pale/40 text-gold-pale transition-[transform,background-color] duration-300 ease-premium group-hover:scale-105 group-hover:bg-gold-pale/10 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
        <Plus className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <span className={`font-display leading-tight text-primary-foreground ${full ? 'text-[30px] sm:text-[34px]' : 'text-[26px]'}`}>
        New album
      </span>
      <span className="text-[11px] uppercase tracking-[0.2em] text-gold-pale/70">Begin a new chapter</span>
    </Link>
  );
}

function ShelfBook({
  album,
  stickerUrlFor,
}: {
  album: LibraryAlbum;
  stickerUrlFor?: (stickerId: string) => string | undefined;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = KIND[kindOf(album)];
  const year = new Date(album.updatedAt).getFullYear().toString();
  const editable = !album.purchase;

  useEffect(() => {
    if (!confirming) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) {
        setConfirming(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirming, deleting]);

  const onConfirm = async () => {
    setDeleting(true);
    setError(null);
    const res = await deleteAlbum(album.id);
    if (res.ok) router.refresh();
    else {
      setError(res.error);
      setDeleting(false);
    }
  };

  return (
    <div className="group relative w-[150px]">
      <Link href={`/albums/${album.id}`} className="block">
        <div className="flex h-[248px] items-end justify-center">
          <Book
            title={album.title}
            year={year}
            size="sm"
            thickness={album.size >= 100 ? 12 : 9}
            cover={paletteFor(album.id)}
            /* THE ALBUM'S ACTUAL FRONT COVER — same renderer as the builder, the preview and the
               PDF, now with its artwork resolved. Not a second representation that can drift. */
            coverContent={albumCoverFace(album.cover, album.title, album.coverImageUrl, stickerUrlFor)}
            spineContent={albumCoverSpine(album.cover, album.title)}
          />
        </div>
        <div className="mt-3.5">
          <p className="truncate font-display text-lg leading-tight text-primary">{album.title}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{album.size} pages</p>
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${k.color} ${k.bg}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${k.dot}`} />
            {k.label}
          </span>
        </div>
      </Link>

      {editable && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${album.title}`}
          className="absolute right-0 top-2 rounded-[2px] bg-background/80 p-1.5 text-destructive opacity-40 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 md:opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div className="animate-rise w-full max-w-sm border bg-card p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Delete “{album.title}”?
              </h3>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(false)} disabled={deleting} aria-label="Close">
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This permanently deletes the album, <strong>all uploaded photos</strong>, and the saved layout. This cannot
              be undone.
            </p>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
                {deleting ? <InlineLoader /> : <Trash2 />} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
