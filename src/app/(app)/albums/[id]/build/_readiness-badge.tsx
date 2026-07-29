'use client';

import { AlertTriangle, Crop, CheckCircle2, Clock, Ban } from 'lucide-react';
import type { Readiness, ReadinessLevel } from './_quality-model';

/**
 * PRINT-READINESS BADGE — the smallest possible way to say "this frame is worth a second look".
 *
 * DESIGN RULE, and the reason this component is so short: it renders NOTHING for a frame that is
 * fine, and nothing for a frame whose state another badge already describes. `UploadBadge` owns
 * processing and failure; empty frames are already unmistakably empty. That leaves exactly two
 * things this badge exists to say — the photo is soft, or the crop has gone too far — and both
 * are conditions the user cannot otherwise see, because the screen is showing them a 400px
 * preview of something that will print at 20cm.
 *
 * So an album in good shape carries no badges at all. That silence is the feature: when one
 * does appear it means something, and it never has to shout to be noticed.
 *
 * It sits bottom-LEFT because `UploadBadge` owns top-left and the slot controls own top-right —
 * three corners, three owners, no overlap at any zoom.
 */

const ICONS: Record<ReadinessLevel, typeof AlertTriangle> = {
  good: CheckCircle2,
  notice: Crop,
  attention: AlertTriangle,
  empty: Ban,
  processing: Clock,
  failed: AlertTriangle,
};

/** Levels this badge draws. Everything else is already described by another surface. */
const DRAWS: ReadinessLevel[] = ['attention', 'notice'];

export default function ReadinessBadge({
  readiness,
  size = 'default',
}: {
  readiness: Readiness | undefined;
  /** `compact` for overlays and small frames, where the label would crowd the picture out. */
  size?: 'compact' | 'default';
}) {
  if (!readiness || !DRAWS.includes(readiness.level)) return null;
  const Icon = ICONS[readiness.level];
  const attention = readiness.level === 'attention';
  const compact = size === 'compact';

  return (
    <span
      title={readiness.detail}
      className={`pointer-events-none absolute bottom-1.5 left-1.5 z-[6] inline-flex items-center gap-1 rounded-full font-medium shadow-sm ring-1 backdrop-blur-sm ${
        attention
          ? 'bg-warning/90 text-warning-foreground ring-warning/30'
          : 'bg-background/85 text-muted-foreground ring-border/70'
      } ${compact ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-0.5 text-[10px]'}`}
    >
      <Icon className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />
      {/* The label is dropped on the smallest frames — the icon plus the tooltip still carry it. */}
      <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{readiness.label}</span>
    </span>
  );
}

/** The same vocabulary as a bare dot, for page thumbnails where any pill would be noise. */
export function ReadinessDot({ level }: { level: ReadinessLevel | undefined }) {
  if (!level || level === 'good' || level === 'processing') return null;
  const tone =
    level === 'attention' || level === 'failed' ? 'bg-warning' : level === 'empty' ? 'bg-muted-foreground/60' : 'bg-muted-foreground/45';
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full ring-1 ring-white/70 ${tone}`}
    />
  );
}
