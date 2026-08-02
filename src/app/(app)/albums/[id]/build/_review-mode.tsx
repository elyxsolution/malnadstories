'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  AlertTriangle,
  Eye,
  EyeOff,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import PairContent, { PrintGutter, type PairPhoto } from './_pair-frame';
import { CoverDesignFromConfig, BackCoverDesign, SpineDesign } from './_cover-render';
import { useBuilderDimensions } from './_dimensions';
import type { Block } from '@/lib/builder/model';
import { spineWidthFor, type CoverConfig } from '@/lib/builder/cover';
import type { QualityIssue, QualityReport } from './_quality-model';

/**
 * ALBUM REVIEW MODE — the album with the software taken away.
 *
 * Every editing affordance in the builder exists to make a photographer faster: rails, handles,
 * badges, drop zones, selection rings. All of it is noise the moment the question changes from
 * "how do I build this" to "is this the book I want to send". So review mode renders the SAME
 * spreads through the SAME `PairContent` the canvas, the flipbook and the PDF use — and then
 * removes literally everything else. Nothing on this screen can modify the album.
 *
 * IT IS NOT A SECOND PREVIEW. The flipbook is a showpiece: page-curl physics, a lit stage, built
 * to make someone want the book. This is a working surface: one spread at a time, flat, big,
 * keyboard-driven, with the quality report available as an overlay. They answer different
 * questions, so they are deliberately different screens rather than one screen with a mode flag.
 *
 * COMMENTS ARE A PLACEHOLDER, AND SAY SO. Notes are stored per spread in `localStorage` and
 * never leave the device — no endpoint, no server action, no schema. The panel states that in
 * plain words rather than implying a collaboration feature that doesn't exist. When a real
 * commenting backend arrives, this component is where it plugs in; until then it is a notebook.
 *
 * ACCESSIBILITY. A labelled `dialog` that takes focus on open and returns it on close, arrow-key
 * page navigation, Escape to leave, visible focus rings throughout, and every transition behind
 * `motion-safe` so reduced-motion users get instant page changes.
 */

type PhotoFor = (id: string | null | undefined) => PairPhoto | undefined;

/**
 * The printed surfaces, in the order the PDF emits them. `spine` is here because it is now a real
 * printed page (see `_print-album`) — review exists to show the customer every surface that will
 * be manufactured, and a surface they can author but never proof is the gap this closes.
 */
type Page = { kind: 'cover' } | { kind: 'spread'; block: Block; index: number } | { kind: 'back' } | { kind: 'spine' };

export default function ReviewMode({
  blocks,
  photoFor,
  stickerUrlFor,
  cover,
  report,
  albumId,
  startIndex = 0,
  showGutter = true,
  onClose,
  onGoToIssue,
}: {
  blocks: Block[];
  photoFor: PhotoFor;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Draw the printed fold (Album Settings → Show print gutter). */
  showGutter?: boolean;
  /** `size` is the album's leaf count — it sets how thick the spine proofs, via `spineWidthFor`. */
  cover: { config: CoverConfig; title: string; frontImageUrl: string | null; backImageUrl: string | null; size: number };
  report: QualityReport;
  albumId: string;
  /** Which content spread to open on — normally whatever the builder was showing. */
  startIndex?: number;
  onClose: () => void;
  /** Leave review mode and take the builder to this issue — the one action that edits. */
  onGoToIssue: (issue: QualityIssue) => void;
}) {
  const { page: pageRatio, pair: pairRatio } = useBuilderDimensions();
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  const pages = useMemo<Page[]>(
    () => [
      { kind: 'cover' as const },
      ...blocks.map((block, index) => ({ kind: 'spread' as const, block, index })),
      { kind: 'back' as const },
      { kind: 'spine' as const },
    ],
    [blocks],
  );

  const [at, setAt] = useState(() => Math.min(pages.length - 1, Math.max(0, startIndex + 1)));
  const [zoom, setZoom] = useState(1);
  const [showIssues, setShowIssues] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const current = pages[Math.min(at, pages.length - 1)];

  /** Issues grouped by the spread they sit on — computed once, not per render of a row. */
  const issuesBySpread = useMemo(() => {
    const map = new Map<number, QualityIssue[]>();
    for (const issue of report.issues) {
      const loc = issue.location;
      if (loc.kind !== 'spread' && loc.kind !== 'frame') continue;
      const list = map.get(loc.blockIndex);
      if (list) list.push(issue);
      else map.set(loc.blockIndex, [issue]);
    }
    return map;
  }, [report.issues]);

  const coverIssues = useMemo(() => report.issues.filter((i) => i.location.kind === 'cover'), [report.issues]);
  const activeIssues =
    current?.kind === 'spread' ? (issuesBySpread.get(current.index) ?? []) : current?.kind === 'cover' ? coverIssues : [];

  // ── private notes (this device only) ─────────────────────────────────────────
  const notesKey = `ms-builder-notes:${albumId}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(notesKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') clean[k] = v;
        setNotes(clean);
      }
    } catch {
      /* corrupt or unavailable storage — start with no notes */
    }
  }, [notesKey]);

  const noteId =
    current?.kind === 'spread' ? `spread:${current.block.key}` : current?.kind === 'cover' ? 'cover' : (current?.kind ?? 'back');
  const writeNote = useCallback(
    (value: string) => {
      setNotes((prev) => {
        const next = { ...prev };
        if (value.trim() === '') delete next[noteId];
        else next[noteId] = value;
        try {
          localStorage.setItem(notesKey, JSON.stringify(next));
        } catch {
          /* storage full — the note stays in memory for this session */
        }
        return next;
      });
    },
    [noteId, notesKey],
  );

  const noteCount = useMemo(() => Object.keys(notes).length, [notes]);

  // ── navigation ───────────────────────────────────────────────────────────────
  const go = useCallback(
    (delta: number) => setAt((i) => Math.max(0, Math.min(pages.length - 1, i + delta))),
    [pages.length],
  );

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await rootRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* fullscreen unavailable — the overlay already fills the viewport */
    }
  };
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /**
   * Review mode owns the keyboard while it is open — it is a modal surface, and the builder's
   * shortcut table must not fire underneath it (⌘Z on a review screen would be baffling). The
   * listener runs in the CAPTURE phase for exactly that reason, and stops what it handles.
   */
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    rootRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Typing a note must never page the album.
      if (el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT') {
        if (e.key === 'Escape') (el as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return; // let the browser leave fullscreen first
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        e.stopPropagation();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        e.stopPropagation();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setAt(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setAt(pages.length - 1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)));
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setShowIssues((v) => !v);
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNotesOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [go, onClose, pages.length]);

  const label =
    current?.kind === 'cover'
      ? 'Front cover'
      : current?.kind === 'back'
        ? 'Back cover'
        : current?.kind === 'spine'
          ? 'Spine'
          : `Spread ${(current?.index ?? 0) + 1} of ${blocks.length}`;

  const isSpread = current?.kind === 'spread';
  const isSpine = current?.kind === 'spine';
  // A spread is twice as wide as a single page; the spine is a sliver of one. Its proportions come
  // from the SAME `spineWidthFor` the builder canvas, the cover preview and the PDF use.
  const spineAspect = pageRatio * spineWidthFor(cover.size);
  const stageWidth = isSpread ? 'min(94vw, 1180px)' : isSpine ? 'min(14vw, 130px)' : 'min(52vw, 560px)';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Album review"
      tabIndex={-1}
      className="motion-safe:animate-fade-in fixed inset-0 z-[110] flex flex-col bg-[rgb(12_16_14/0.97)] focus:outline-none"
    >
      {/* ── top bar: identity + the three view toggles, nothing that edits ───────── */}
      <header className="relative z-10 flex flex-none items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] tracking-tight text-white/90">{cover.title || 'Album review'}</p>
          <p className="text-[11px] text-white/45">Review mode — nothing here changes your album</p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <StageBtn
            label={showIssues ? 'Hide quality notes (I)' : 'Show quality notes (I)'}
            active={showIssues}
            onClick={() => setShowIssues((v) => !v)}
          >
            {showIssues ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </StageBtn>
          <StageBtn label={notesOpen ? 'Hide notes (N)' : 'Notes (N)'} active={notesOpen} onClick={() => setNotesOpen((v) => !v)}>
            <MessageSquare className="h-4 w-4" />
            {noteCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-studio px-1 text-[9px] font-semibold text-studio-foreground">
                {noteCount}
              </span>
            )}
          </StageBtn>
          <span className="mx-1 h-5 w-px bg-white/15" />
          <StageBtn label="Zoom out (−)" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}>
            <ZoomOut className="h-4 w-4" />
          </StageBtn>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="Reset zoom (0)"
            className="w-12 rounded-md py-1 text-center text-[12px] tabular-nums text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {Math.round(zoom * 100)}%
          </button>
          <StageBtn label="Zoom in (+)" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}>
            <ZoomIn className="h-4 w-4" />
          </StageBtn>
          <StageBtn label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </StageBtn>
          <StageBtn label="Close review (Esc)" onClick={onClose}>
            <X className="h-4 w-4" />
          </StageBtn>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── the page itself ──────────────────────────────────────────────────── */}
        <main className="ms-scroll relative flex min-w-0 flex-1 items-center justify-center overflow-auto px-6 pb-4">
          <div
            className="relative motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-glide"
            style={{ width: stageWidth, transform: `scale(${zoom})` }}
          >
            <div
              className="relative overflow-hidden bg-white shadow-paper"
              style={{
                aspectRatio: isSpread ? pairRatio : isSpine ? spineAspect : pageRatio,
                containerType: 'inline-size',
              }}
            >
              {current?.kind === 'cover' ? (
                <CoverDesignFromConfig
                  config={cover.config}
                  title={cover.title}
                  imageUrl={cover.frontImageUrl}
                  pageAspect={pageRatio}
                  stickerUrlFor={stickerUrlFor}
                />
              ) : current?.kind === 'back' ? (
                <BackCoverDesign back={cover.config.back} imageUrl={cover.backImageUrl} stickerUrlFor={stickerUrlFor} />
              ) : current?.kind === 'spine' ? (
                <SpineDesign config={cover.config} title={cover.title} pageAspect={pageRatio} />
              ) : current ? (
                <>
                  <PairContent block={current.block} photoFor={photoFor} stickerUrlFor={stickerUrlFor} badge="compact" />
                  {/* The same fold the builder canvas draws — reviewing a spread should show the
                      customer exactly the gutter they designed around. */}
                  {showGutter && <PrintGutter />}
                </>
              ) : null}
            </div>
          </div>
        </main>

        {/* ── notes (a notebook, and labelled as one) ──────────────────────────── */}
        {notesOpen && (
          <aside className="motion-safe:animate-fade-in flex w-[300px] flex-none flex-col border-l border-white/10 bg-[rgb(16_22_18/0.9)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight text-white/90">Notes on {label.toLowerCase()}</h2>
              {notes[noteId] && (
                <button
                  type="button"
                  onClick={() => writeNote('')}
                  aria-label="Clear this note"
                  className="grid h-6 w-6 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <textarea
              value={notes[noteId] ?? ''}
              onChange={(e) => writeNote(e.target.value)}
              placeholder="What would you change about this page?"
              aria-label={`Private note on ${label}`}
              className="ms-scroll mt-2.5 min-h-[160px] flex-1 resize-none rounded-lg border border-white/15 bg-white/[0.06] p-2.5 text-[12.5px] leading-relaxed text-white/90 placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            />
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/40">
              Notes stay in this browser. They aren&rsquo;t sent to us, aren&rsquo;t printed, and
              won&rsquo;t follow you to another device — a scratchpad for your own review pass.
            </p>
          </aside>
        )}
      </div>

      {/* ── quality overlay for the page on screen ──────────────────────────────── */}
      {showIssues && activeIssues.length > 0 && (
        <div className="motion-safe:animate-fade-in pointer-events-auto absolute bottom-20 left-1/2 z-20 w-[min(560px,90vw)] -translate-x-1/2 space-y-1 rounded-xl border border-white/12 bg-[rgb(16_22_18/0.92)] p-2 backdrop-blur-sm">
          {activeIssues.slice(0, 3).map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => onGoToIssue(issue)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <AlertTriangle
                className={`mt-0.5 h-3.5 w-3.5 flex-none ${issue.severity === 'attention' ? 'text-warning' : 'text-white/45'}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium leading-snug text-white/90">{issue.title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{issue.detail}</span>
              </span>
              <span className="mt-0.5 flex-none text-[10.5px] font-medium text-studio-bright">Fix</span>
            </button>
          ))}
          {activeIssues.length > 3 && (
            <p className="px-2 pb-0.5 text-[10.5px] text-white/40">
              +{activeIssues.length - 3} more on this page — the Quality panel lists them all.
            </p>
          )}
        </div>
      )}

      {/* ── page navigation ─────────────────────────────────────────────────────── */}
      <footer className="relative z-10 flex flex-none flex-col items-center gap-1.5 pb-5">
        <div className="flex items-center gap-4">
          <StageBtn label="Previous page (←)" onClick={() => go(-1)} disabled={at <= 0}>
            <ChevronLeft className="h-5 w-5" />
          </StageBtn>
          <span className="min-w-[8.5rem] text-center text-[12.5px] font-medium tabular-nums text-white/85" aria-live="polite">
            {label}
          </span>
          <StageBtn label="Next page (→)" onClick={() => go(1)} disabled={at >= pages.length - 1}>
            <ChevronRight className="h-5 w-5" />
          </StageBtn>
        </div>
        <span className="text-[11px] text-white/40">← → to page · I for quality notes · N for your notes · Esc to leave</span>
      </footer>
    </div>
  );
}

function StageBtn({
  label,
  onClick,
  children,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`relative grid h-9 w-9 place-items-center rounded-full transition-all duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-25 ${
        active ? 'bg-white/22 text-white' : 'bg-white/10 text-white/90 hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}
