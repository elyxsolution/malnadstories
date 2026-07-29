'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import type { PhotoUiState } from './_photo-state';

/**
 * THE photo-state overlay — one component, one visual language, everywhere a photo appears:
 * tray, canvas base slots, canvas overlays, in-app preview, flipbook and page navigator.
 *
 * THREE STATES, AND ONLY THREE. The pipeline behind a photo has five internal phases — queued,
 * uploading, confirmed-and-waiting, worker-processing, ready — and for a while the UI narrated
 * all of them ("Queued · 3", "Processing", "Enhancing", "Almost there"). Real use showed that
 * was answering a question nobody asked. A photographer needs one bit of information:
 *
 *     can I use this photo yet?
 *
 * So the five phases collapse to `uploading | failed | ready`, and `ready` renders nothing at
 * all. The absence of chrome IS the ready state, which is why a tray that has just absorbed 200
 * photos settles into looking completely calm. The internal phases still exist and still drive
 * the pipeline — they simply stopped being the user's problem.
 *
 * WHAT WENT AWAY, AND WHY IT WAS SAFE. The escalating "Processing → Enhancing → Almost there"
 * copy needed a shared 5-second clock (`useSlowTick`) subscribed per badge; with the copy gone,
 * so is the subscription — a tray of 200 in-flight photos no longer re-renders every 5s just to
 * relabel itself. Queue positions went the same way: they made the tray recount the entire
 * photo list on every render to tell someone they were 47th in a line that was moving fine.
 *
 * THREE SIZES, ONE LANGUAGE. `micro` is a bare dot for navigator thumbs (~60px, where any text
 * would be illegible noise), `compact` for canvas frames where the photo must stay the hero, and
 * the default for the tray. Only the density changes.
 */

export type BadgeSize = 'micro' | 'compact' | 'default';

/** What the user is shown. Everything that isn't finished or broken is simply "coming in". */
export type BadgeState = 'uploading' | 'failed' | null;

/**
 * THE collapse, in one place. Every surface derives its badge from this, so no component can
 * accidentally reintroduce an internal phase into the interface.
 */
export function badgeState(state: PhotoUiState): BadgeState {
  if (state === 'failed') return 'failed';
  if (state === 'ready') return null;
  return 'uploading'; // queued · uploading · processing — indistinguishable, on purpose
}

/**
 * Opacity applied to the image itself — ONE value for "not ready yet", where there used to be a
 * three-step ramp that leaked the phase it was in.
 */
export function stateOpacityClass(state: PhotoUiState): string {
  return badgeState(state) === 'uploading' ? 'opacity-80' : '';
}

/** A dot colour per state, shared by the micro badge and any compact status strip. */
export function stateDotClass(state: PhotoUiState): string {
  const s = badgeState(state);
  return s === 'failed' ? 'bg-destructive' : s === 'uploading' ? 'bg-studio' : 'bg-studio';
}

export default function UploadBadge({
  state,
  progress,
  size = 'default',
}: {
  state: PhotoUiState;
  /** 0–100, only known while bytes are actually moving. Absent ⇒ a bare spinner. */
  progress?: number;
  size?: BadgeSize;
}) {
  const kind = badgeState(state);
  if (kind === null) return null;

  // The micro variant is a bare status dot — same colour vocabulary, no text.
  if (size === 'micro') {
    return (
      <span
        className={`pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-1 ring-white/70 ${stateDotClass(state)}`}
        aria-hidden
      />
    );
  }

  const compact = size === 'compact';
  const pill = `pointer-events-none absolute left-1.5 top-1.5 z-[6] inline-flex items-center gap-1 rounded-full bg-background/85 font-medium text-foreground shadow-sm ring-1 ring-border/70 backdrop-blur-sm ${
    compact ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-0.5 text-[10px]'
  }`;
  const glyph = compact ? 'h-2.5 w-2.5' : 'h-3 w-3';

  if (kind === 'failed') {
    return (
      <span className={`${pill} text-destructive`} role="status">
        <AlertTriangle className={glyph} aria-hidden />
        Failed
      </span>
    );
  }

  // UPLOADING. When bytes are moving we show the number, because a number is the one thing that
  // proves progress. When they aren't — queued, or the worker is finishing up — a bare spinner
  // says "still coming" without inventing a stage name. Both read as the same state.
  const pct = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;
  return (
    <>
      <span className={pill} role="status" aria-label="Uploading">
        <Loader2 className={`${glyph} motion-safe:animate-spin`} aria-hidden />
        {pct !== null && <span className="tabular-nums">{pct}%</span>}
      </span>
      {/* One hairline at the bottom edge — legible at thumbnail size, unnoticeable otherwise. */}
      {pct !== null && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-[3px] bg-black/20" aria-hidden>
          <span className="block h-full bg-studio transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        </span>
      )}
    </>
  );
}
