import { cn } from '@/lib/utils';
import { resolveStaticMessage, type MessageGroup } from './loading-config';

/**
 * MalnadLoader — THE single loading animation for the whole app (from
 * frontend/loading_animation). Pure markup + the global `mal-` CSS (src/app/loader.css,
 * loaded once). No JS animation, no 'use client' → safe in Server Components, route
 * loading.tsx, and Suspense fallbacks. Never duplicate or redesign this; scale it via `size`.
 *
 * Accessibility: role="status" + aria-live="polite" + a visually-hidden label so screen
 * readers announce the busy state; the animation itself is aria-hidden and honors
 * prefers-reduced-motion (in the CSS).
 */
const NATIVE = 180; // the animation's intrinsic px size

// The exact photo cards from the source animation (polaroid/print · scene colour), reproduced
// verbatim — do NOT redesign.
const PHOTOS = [
  { cls: 'mal-photo--polaroid mal-p1', scene: 'mal-scene--green' },
  { cls: 'mal-photo--print mal-p2', scene: 'mal-scene--gold' },
  { cls: 'mal-photo--polaroid mal-p3', scene: 'mal-scene--teal' },
  { cls: 'mal-photo--print mal-p4', scene: 'mal-scene--earth' },
  { cls: 'mal-photo--polaroid mal-p5', scene: 'mal-scene--blue' },
] as const;

export function MalnadLoader({
  size = 96,
  label,
  className,
}: {
  /** Rendered box size in px (the 180px animation is scaled to fit). */
  size?: number;
  /** Optional visible caption; also used as the accessible name. */
  label?: string;
  className?: string;
}) {
  const scale = size / NATIVE;
  return (
    <div className={cn('inline-flex flex-col items-center', className)} role="status" aria-live="polite" aria-busy="true">
      <div className="relative flex-none" style={{ width: size, height: size }} aria-hidden="true">
        <div
          className="malnad-album-loader"
          style={{ position: 'absolute', top: '50%', left: '50%', transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <div className="mal-shadow" />
          <div className="mal-album">
            <div className="mal-cover" />
            <div className="mal-frame" />
            <div className="mal-pages">
              <div className="mal-page mal-page--l" />
              <div className="mal-page mal-page--r" />
            </div>
            <div className="mal-photos">
              {PHOTOS.map((p) => (
                <div key={p.cls} className={`mal-photo ${p.cls}`}>
                  <div className="mal-face mal-back">
                    <div className="mal-horizon" />
                  </div>
                  <div className="mal-face mal-front">
                    <div className={`mal-scene ${p.scene}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {label && <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </div>
  );
}

/**
 * InlineLoader — the small variant for buttons + inline async regions (the drop-in replacement
 * for the old `<Loader2 className="animate-spin" />`). Same animation, small size.
 */
export function InlineLoader({ size = 18, className }: { size?: number; className?: string }) {
  const scale = size / NATIVE;
  return (
    <span className={cn('relative inline-block flex-none align-middle', className)} style={{ width: size, height: size }} role="status" aria-hidden="true">
      <span
        className="malnad-album-loader"
        style={{ position: 'absolute', top: '50%', left: '50%', transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <span className="mal-shadow" />
        <span className="mal-album" style={{ display: 'block' }}>
          <span className="mal-cover" style={{ display: 'block' }} />
          <span className="mal-frame" style={{ display: 'block' }} />
          <span className="mal-pages">
            <span className="mal-page mal-page--l" />
            <span className="mal-page mal-page--r" />
          </span>
        </span>
      </span>
    </span>
  );
}

/**
 * LoadingScreen — a centered loading region for route `loading.tsx`, Suspense fallbacks, and any
 * async section. `fullscreen` fills the viewport; otherwise it fills its container with padding.
 */
export function LoadingScreen({
  label,
  messageGroup,
  size = 120,
  fullscreen = false,
  className,
}: {
  /** Explicit message; else derived from `messageGroup` (its first line) or the generic default. */
  label?: string;
  messageGroup?: MessageGroup;
  size?: number;
  fullscreen?: boolean;
  className?: string;
}) {
  // Server-safe (no hooks) → static copy from the centralized config. Route loaders are brief;
  // rotation belongs to the overlay. Never a hardcoded string.
  const text = label ?? resolveStaticMessage({ messageGroup });
  return (
    // `mal-fade` gives a smooth fade+scale-in on mount (route loading / Suspense) — CSS-only, so
    // this stays a Server Component; honours prefers-reduced-motion in loader.css.
    <div
      className={cn('mal-fade flex w-full flex-col items-center justify-center', fullscreen ? 'min-h-[calc(100vh-3.5rem)]' : 'min-h-[40vh] py-16', className)}
      aria-busy="true"
    >
      <MalnadLoader size={size} label={text} />
    </div>
  );
}
