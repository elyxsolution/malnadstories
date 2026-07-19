import { InlineLoader, LoadingScreen, type MessageGroup } from '@/components/loading';

/**
 * Standard loading primitives.
 *
 * `Skeleton` — a pulsing placeholder block. Use it ONLY to reserve final-layout space (no layout
 * shift) while server data loads; it is a layout placeholder, not the loading animation.
 * `Spinner` — the ONE inline busy indicator (the Malnad album loader) for buttons + small async
 * regions. Re-pointed to the unified loading system so there is a single animation everywhere.
 * `LoadingBlock` — a centered async/Suspense region (the unified LoadingScreen).
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} aria-hidden />;
}

/** Inline busy indicator — the unified animation. `className` kept for call-site compatibility. */
export function Spinner({ className = '' }: { className?: string }) {
  return <InlineLoader size={18} className={className} />;
}

/** A vertically-centered loading region (e.g. an async section / Suspense fallback). Copy is
 *  centralized: omit `label` for the generic default, or pass a MessageGroup. */
export function LoadingBlock({ label, messageGroup }: { label?: string; messageGroup?: MessageGroup }) {
  return <LoadingScreen label={label} messageGroup={messageGroup} size={96} />;
}
