'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Anchor } from './_use-anchor-rect';

/**
 * THE FLOATING CONTEXT BAR — the shell every on-canvas toolbar is built from.
 *
 * It holds no editing logic whatsoever. It is a positioner and a keyboard host: given an anchor
 * rect it places itself above (or below, near the top edge) whatever is selected, keeps itself
 * inside the viewport, and implements the ARIA toolbar interaction pattern. What goes in it is
 * entirely the caller's business — which is why one shell serves photos, text, stickers, QR and
 * the page itself without knowing what any of them are.
 *
 * WHY `position: fixed`. The canvas scrolls and zooms. A bar rendered inside the scroller would
 * be clipped by `overflow: auto` the moment the element neared an edge, and would need its own
 * transform to survive zoom. Fixed positioning against a measured anchor (`useAnchorRect`) side-
 * steps both, and costs one arithmetic update per scroll frame.
 *
 * KEYBOARD. A real `role="toolbar"` with roving tabindex: ONE tab stop for the whole bar, then
 * ←/→ (and Home/End) to move between controls, matching the platform pattern people already know
 * from every desktop editor. Escape hands focus back to the canvas rather than dropping it at the
 * top of the document. Items are discovered from the DOM via `[data-bar-item]`, so a caller
 * composing arbitrary children gets the behaviour for free with no registration ceremony.
 *
 * MOTION. A 120ms scale-from-anchor on appear, and nothing else — no slide, no bounce, no exit
 * animation (a bar that lingers after you deselect reads as lag). `motion-safe:` throughout, so
 * reduced-motion users get an instant swap.
 */

const GAP = 10; // px between the anchor and the bar
const EDGE = 12; // px minimum distance from any viewport edge

export function CanvasBar({
  anchor,
  label,
  onEscape,
  children,
}: {
  anchor: Anchor | null;
  /** Announced by screen readers, e.g. "Photo tools". */
  label: string;
  /** Escape pressed inside the bar — hosts use this to return focus to the canvas. */
  onEscape?: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  /** Place the bar before paint, so it never appears in the wrong spot and jumps. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setPos(null);
      return;
    }
    const box = el.getBoundingClientRect();
    const wantTop = anchor.top - box.height - GAP;
    // Flip below the selection when there isn't room above it — which is exactly what happens
    // for anything near the top of the spread.
    const below = wantTop < EDGE;
    const top = below ? Math.min(anchor.top + anchor.height + GAP, window.innerHeight - box.height - EDGE) : wantTop;
    const centred = anchor.left + anchor.width / 2 - box.width / 2;
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - box.width - EDGE));
    setPos((prev) =>
      prev && prev.left === left && prev.top === top && prev.below === below ? prev : { left, top, below },
    );
  }, [anchor, children]);

  /** Roving tabindex over whatever the caller rendered. */
  const items = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-bar-item]:not([disabled])') ?? []),
    [],
  );

  useEffect(() => {
    const list = items();
    // Exactly one tab stop: the first control. Everything else is reached with the arrow keys.
    list.forEach((el, i) => {
      el.tabIndex = i === 0 ? 0 : -1;
    });
  }, [items, children]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const list = items();
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return; // focus is inside a popover — leave arrow keys to it
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? list.length - 1
          : e.key === 'ArrowRight'
            ? (current + 1) % list.length
            : (current - 1 + list.length) % list.length;
    list.forEach((el, i) => {
      el.tabIndex = i === next ? 0 : -1;
    });
    list[next].focus();
  };

  if (!anchor) return null;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      // The bar must never start a canvas drag or clear the selection it is describing.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.top,
        transformOrigin: pos?.below ? 'top center' : 'bottom center',
        // Hidden until placed, so the first paint is never in the wrong position.
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="motion-safe:animate-scale-in fixed z-[70] flex items-center gap-0.5 rounded-xl border border-border/80 bg-card/95 p-1 shadow-elevated backdrop-blur-sm"
    >
      {children}
    </div>
  );
}

/** One control in the bar. `data-bar-item` is what makes roving focus find it. */
export function BarBtn({
  label,
  icon,
  onClick,
  active,
  disabled,
  destructive,
  text,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** Optional visible text, for actions whose icon alone would be a guess ("Replace"). */
  text?: string;
}) {
  return (
    <button
      type="button"
      data-bar-item
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg text-[12px] font-medium transition-colors duration-100 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-35 [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        text ? 'px-2' : 'w-7'
      } ${
        active
          ? 'bg-studio text-studio-foreground'
          : destructive
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-foreground hover:bg-secondary'
      }`}
    >
      {icon}
      {text}
    </button>
  );
}

export function BarSep() {
  return <span className="mx-0.5 h-4 w-px flex-none bg-border" aria-hidden />;
}

/** A non-interactive caption, so a bar can say what it is acting on. */
export function BarLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 text-[11px] font-medium text-muted-foreground">{children}</span>;
}

/**
 * A bar control that opens a floating panel — how the detailed inspectors (typography, photo
 * adjustments, QR settings) reach the canvas without a permanent column.
 *
 * The panel is a sibling of the bar rather than a child, so it can be taller than the bar and
 * escape its overflow. It closes on outside pointer-down and on Escape, and returns focus to its
 * trigger — the same contract the context menu already honours.
 */
export function BarPopover({
  label,
  icon,
  text,
  width = 268,
  swatch,
  overflowVisible,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  text?: string;
  width?: number;
  /** Render a colour swatch as the trigger's visual (the text-colour control). */
  swatch?: string;
  /** Let absolutely-positioned flyouts inside the panel (the colour spectrum) escape its box. */
  overflowVisible?: boolean;
  /** Plain content, or a render prop receiving `close` so menu items can dismiss on select. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = btnRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;
    // Prefer below the trigger; flip above when the viewport bottom is closer.
    const below = trigger.bottom + panel.height + GAP < window.innerHeight - EDGE;
    const top = below ? trigger.bottom + GAP : Math.max(EDGE, trigger.top - panel.height - GAP);
    const left = Math.max(EDGE, Math.min(trigger.left + trigger.width / 2 - width / 2, window.innerWidth - width - EDGE));
    setPos({ left, top });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-bar-item
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `bar-popover-${id}` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg text-[12px] font-medium transition-colors duration-100 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright [&_svg]:h-3.5 [&_svg]:w-3.5 ${
          text || icon || swatch ? 'px-2' : 'w-7'
        } ${open ? 'bg-secondary text-foreground' : 'text-foreground hover:bg-secondary'}`}
      >
        {icon}
        {swatch && (
          <span
            aria-hidden
            className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-inset ring-black/15"
            style={{ background: swatch }}
          />
        )}
        {text}
        <ChevronDown className={`!h-3 !w-3 opacity-50 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={`bar-popover-${id}`}
          role="dialog"
          aria-label={label}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width, visibility: pos ? 'visible' : 'hidden' }}
          className={`motion-safe:animate-scale-in fixed z-[71] flex max-h-[min(60vh,460px)] flex-col rounded-xl border border-border/80 bg-card shadow-elevated ${
            overflowVisible ? 'overflow-visible' : 'overflow-hidden'
          }`}
        >
          {typeof children === 'function' ? children(() => { setOpen(false); btnRef.current?.focus(); }) : children}
        </div>
      )}
    </>
  );
}
