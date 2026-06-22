import { Loader2 } from 'lucide-react';

/**
 * Standard loading primitives (Phase 10E.2).
 *
 * `Skeleton` — a pulsing placeholder block. Use it to reserve the final layout's space
 * (no layout shift) while server data loads, sized via className.
 * `Spinner` — the one inline busy indicator (Loader2, consistent size/motion) for buttons
 * and small async regions.
 *
 * Motion is uniform: Tailwind `animate-pulse` for skeletons, `animate-spin` for spinners.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden />;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} aria-hidden />;
}

/** A vertically-centered loading region (e.g. a Suspense fallback) — consistent padding + spinner. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Spinner className="h-5 w-5" />
      {label}
    </div>
  );
}
