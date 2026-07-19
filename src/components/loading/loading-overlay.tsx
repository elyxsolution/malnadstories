'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MalnadLoader } from './malnad-loader';
import { LoadingConfig, resolveLoadingMessages, type MessageGroup, type MessageInput } from './loading-config';
import { useDelayedLoading, useRotatingMessage } from './use-delayed-loading';

/**
 * LoadingOverlay — full-screen, interaction-locking overlay using the ONE animation. Timing comes
 * entirely from LoadingConfig (delay before appear · minimum visible duration · fade+scale). Used
 * standalone (controlled `open`) and by the global provider below.
 *
 * Contextual copy: pass `message` (static) or `messages` (rotates every messageRotationInterval).
 * Accessibility: role="alertdialog" + aria-modal + aria-busy + a labelled loader; focus is pulled
 * into the overlay and body scroll locked while visible; honours prefers-reduced-motion (the fade
 * transition is skipped by the media query in loader.css / here it degrades to an instant toggle).
 */
export function LoadingOverlay({
  open,
  message,
  messages,
  messageGroup,
}: {
  open: boolean;
} & MessageInput) {
  const { mounted, shown } = useDelayedLoading(open);
  const resolved = resolveLoadingMessages({ message, messages, messageGroup });
  const label = useRotatingMessage(mounted ? resolved : null, message);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={label}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/70 outline-none backdrop-blur-md transition-[opacity,transform] ease-out motion-reduce:transition-none"
      style={{
        transitionDuration: `${LoadingConfig.overlayFadeDuration}ms`,
        opacity: shown ? 1 : 0,
        transform: shown ? 'scale(1)' : 'scale(0.98)',
      }}
    >
      <MalnadLoader size={128} label={label} />
    </div>
  );
}

// ── Global imperative overlay ─────────────────────────────────────────────────
type ShowOptions = MessageInput | MessageGroup;
type GlobalLoadingApi = {
  show: (opts?: string | ShowOptions) => void;
  hide: () => void;
  /** Wrap a promise: overlay for its duration (smart-delayed), hidden in finally. Returns it. */
  withLoading: <T>(p: Promise<T>, opts?: string | ShowOptions) => Promise<T>;
};

const LoadingContext = createContext<GlobalLoadingApi | null>(null);

// A bare string may be either a named group ('checkout') or a literal message — resolve by lookup.
const GROUP_KEYS = new Set(['generic', 'albumCreation', 'photoUpload', 'samplePreview', 'pdfGeneration', 'checkout', 'login', 'dashboard', 'imageProcessing', 'saving']);
const normalize = (o?: string | ShowOptions): MessageInput => {
  if (!o) return {};
  if (typeof o === 'string') return GROUP_KEYS.has(o) ? { messageGroup: o as MessageGroup } : { message: o };
  return o;
};

/**
 * LoadingProvider — mount once at the root. Provides `useGlobalLoading()` for long-running ops and
 * renders the SINGLE shared overlay (no duplicates). A counter keeps the overlay up across
 * nested/concurrent calls; the overlay itself applies the smart delay / min-duration / fade.
 */
export function LoadingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [opts, setOpts] = useState<MessageInput>({});

  // Single source of truth for the fade duration: publish LoadingConfig → CSS var (loader.css
  // reads var(--mal-fade-duration)). Keeps CSS + TS timing in sync from ONE value.
  useEffect(() => {
    document.documentElement.style.setProperty('--mal-fade-duration', `${LoadingConfig.overlayFadeDuration}ms`);
  }, []);

  const show = useCallback((o?: string | ShowOptions) => {
    setOpts(normalize(o));
    setCount((c) => c + 1);
  }, []);
  const hide = useCallback(() => setCount((c) => Math.max(0, c - 1)), []);
  const withLoading = useCallback(
    <T,>(p: Promise<T>, o?: string | ShowOptions): Promise<T> => {
      show(o);
      return p.finally(hide);
    },
    [show, hide],
  );

  const api = useMemo<GlobalLoadingApi>(() => ({ show, hide, withLoading }), [show, hide, withLoading]);

  return (
    <LoadingContext.Provider value={api}>
      {children}
      <LoadingOverlay open={count > 0} message={opts.message} messages={opts.messages} messageGroup={opts.messageGroup} />
    </LoadingContext.Provider>
  );
}

export function useGlobalLoading(): GlobalLoadingApi {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    return { show: () => {}, hide: () => {}, withLoading: (p) => p };
  }
  return ctx;
}
