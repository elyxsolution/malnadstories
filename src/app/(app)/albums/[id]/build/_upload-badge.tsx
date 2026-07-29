'use client';

import { AlertTriangle } from 'lucide-react';
import type { PhotoUiState } from './_photo-state';
import { processingLabel } from './_photo-state';
import { useSlowTick } from './_use-tick';

/**
 * THE processing overlay — one component, one visual language, everywhere a photo appears:
 * tray, canvas base slots, canvas overlays, in-app preview, flipbook and page navigator.
 *
 * DESIGN INTENT. The photo is the content; its state is chrome, so the chrome recedes. There is
 * exactly one small pill, a graded opacity ramp, and — while bytes are moving — a single 3px
 * hairline. No spinner sits on top of the image, no coloured borders, no pulsing, and nothing
 * loops. `ready` renders NOTHING at all: the absence of chrome is the ready state, which is why
 * a tray that has just absorbed 100 photos settles into looking completely calm.
 *
 * THREE SIZES, ONE LANGUAGE. `micro` is a bare dot for navigator thumbs (~60px, where any text
 * would be illegible noise), `compact` for canvas frames where the photo must stay the hero, and
 * the default for the tray. The vocabulary and colour meaning are identical across all three —
 * only the density changes.
 *
 * LONG PROCESSING. When `since` is supplied, the label escalates on a shared 5s clock:
 * "Processing" → "Enhancing" → "Almost there". It never implies failure, because nothing has
 * failed — the worker is simply still working.
 */

export type BadgeSize = 'micro' | 'compact' | 'default';

/** Opacity applied to the image itself per state — keeps every surface consistent. */
export function stateOpacityClass(state: PhotoUiState): string {
  if (state === 'queued') return 'opacity-50';
  if (state === 'uploading') return 'opacity-70';
  if (state === 'processing') return 'opacity-[0.82]';
  return '';
}

/** A dot colour per state, shared by the micro badge and the queue stepper. */
export function stateDotClass(state: PhotoUiState): string {
  if (state === 'failed') return 'bg-destructive';
  if (state === 'queued') return 'bg-muted-foreground/50';
  if (state === 'uploading') return 'bg-studio';
  if (state === 'processing') return 'bg-studio/60';
  return 'bg-studio';
}

export default function UploadBadge({
  state,
  progress,
  queuePosition,
  since = null,
  size = 'default',
}: {
  state: PhotoUiState;
  /** 0–100, only meaningful while uploading. */
  progress?: number;
  /** 1-based place in the queue, when queued. */
  queuePosition?: number;
  /** When processing began (ms epoch) — drives the escalating label. */
  since?: number | null;
  size?: BadgeSize;
}) {
  // Only subscribe to the clock when this badge could actually escalate.
  const now = useSlowTick(state === 'processing' && since !== null);
  if (state === 'ready') return null;

  // The micro variant is a bare status dot — the same colour vocabulary, no text.
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
  const dot = compact ? 'h-1 w-1' : 'h-1.5 w-1.5';

  if (state === 'failed') {
    return (
      <span className={`${pill} text-destructive`}>
        <AlertTriangle className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        Failed
      </span>
    );
  }

  if (state === 'queued') {
    return (
      <span className={pill}>
        <span className={`${dot} rounded-full ${stateDotClass(state)}`} aria-hidden />
        {queuePosition ? `Queued · ${queuePosition}` : 'Queued'}
      </span>
    );
  }

  if (state === 'uploading') {
    const pct = Math.max(0, Math.min(100, progress ?? 0));
    return (
      <>
        <span className={pill}>
          <span className="tabular-nums">{pct}%</span>
        </span>
        {/* One hairline at the bottom edge — legible at thumbnail size, unnoticeable otherwise. */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-[3px] bg-black/20">
          <span
            className="block h-full bg-studio transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </span>
      </>
    );
  }

  // processing — the label escalates with elapsed time, and never suggests something is wrong.
  return (
    <span className={pill}>
      {/* Deliberately static: the escalating label already conveys "still working", and a
          looping animation on every tile is exactly the restlessness this phase removes. */}
      <span className={`${dot} rounded-full ${stateDotClass(state)}`} aria-hidden />
      {processingLabel(since === null ? null : now - since)}
    </span>
  );
}
