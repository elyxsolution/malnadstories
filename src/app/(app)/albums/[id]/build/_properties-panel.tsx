'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * THE PROPERTIES PANEL — the right-hand slide-in that hosts an object's DETAILED controls.
 *
 * Pass 3's editing philosophy in one component: the floating toolbar owns the common actions,
 * and everything deeper — photo adjustments, advanced typography, sticker and QR settings —
 * lives here, in a docked panel that slides in from the right. It replaces the context bar's
 * popovers for detailed editing, for two reasons a popover can't fix: a popover covers the very
 * canvas you are adjusting (a brightness slider you can't see the photo under is a guess), and
 * it dies with the next click, which makes a multi-slider session ten reopenings.
 *
 * It is a pure HOST, exactly like the popovers were: the existing inspector components render
 * inside it unchanged, with the same callbacks. Editing logic stays in the inspectors; layout
 * state stays in the builder. The panel DOCKS (it is a flex sibling of the canvas, not an
 * overlay) so nothing on the spread is ever hidden behind it — the canvas re-measures via the
 * anchor hook's ResizeObserver, which is the same path a window resize already takes.
 *
 * KEYBOARD. Escape closes the panel and hands focus back to the canvas. The panel is a
 * `role="region"` with a labelled close button — tab into it, adjust, Escape out.
 */
export default function PropertiesPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  /** Close the panel — Escape and the ✕ button both land here. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  // Focus the panel when it OPENS (mount), so Escape works immediately and screen readers
  // announce the region — but never steal focus again as its content re-renders.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={ref}
      role="region"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
      }}
      className="motion-safe:animate-panel-in flex w-[292px] flex-none flex-col border-l border-border/70 bg-card outline-none"
    >
      <div className="flex flex-none items-center justify-between border-b border-border/70 py-2 pl-4 pr-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </aside>
  );
}
