'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Command } from './_use-commands';

/**
 * CONTEXT MENUS — a thin renderer over the command layer.
 *
 * It holds no editing logic whatsoever: a caller decides WHICH commands are relevant for what was
 * right-clicked (a photo, a frame, a page, the canvas, the tray), and this renders them. That is
 * the point of the command layer — the menu, the keyboard and the buttons all invoke the same
 * `Command.run`, so a menu entry can never drift from its shortcut.
 *
 * Disabled commands are FILTERED OUT rather than greyed out: a menu that lists six irrelevant
 * actions is slower to read than one that lists two. Separators appear only between groups that
 * actually rendered something.
 *
 * ACCESSIBILITY. It is a real `menu`/`menuitem` tree: focus moves in on open and is restored on
 * close, ↑/↓ cycle, Enter/Space activate, Escape and outside-click dismiss, and the whole thing
 * is reachable from the keyboard via Shift+F10 / the Menu key, which browsers map to
 * `contextmenu`. Motion is a 120ms scale-from-origin that reduced-motion turns off.
 */

export type MenuGroup = { id: string; commands: Command[] };

export type ContextMenuState = { x: number; y: number; groups: MenuGroup[] } | null;

/** Open/close plumbing, so each surface only has to say what it wants shown. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const open = useCallback((e: React.MouseEvent, groups: MenuGroup[]) => {
    // Nothing actionable → let the browser's own menu through rather than showing an empty one.
    if (groups.every((g) => g.commands.every((c) => !c.enabled))) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, groups });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

export default function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(0);

  const items = state ? state.groups.flatMap((g) => g.commands.filter((c) => c.enabled)) : [];

  // Flip the menu back inside the viewport before first paint, so it never appears off-screen
  // and never visibly jumps.
  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - rect.width - 8);
    const y = Math.min(state.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    restoreFocusTo.current = document.activeElement;
    setActive(0);
    ref.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    // Capture phase so a click that also has its own handler still dismisses the menu.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      // Return focus where it was, so keyboard users aren't dropped at the top of the document.
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [state, onClose]);

  if (!state || items.length === 0) return null;

  const activate = (cmd: Command) => {
    onClose();
    void cmd.run();
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Actions"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive((i) => (i + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive((i) => (i - 1 + items.length) % items.length);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const cmd = items[active];
          if (cmd) activate(cmd);
        }
      }}
      style={{ left: pos.x, top: pos.y, transformOrigin: 'top left' }}
      className="motion-safe:animate-scale-in fixed z-[140] min-w-[188px] overflow-hidden rounded-xl border border-border/80 bg-card/95 p-1 shadow-elevated backdrop-blur-sm focus:outline-none"
    >
      {state.groups.map((group, gi) => {
        const enabled = group.commands.filter((c) => c.enabled);
        if (enabled.length === 0) return null;
        // A separator only where a PREVIOUS group actually rendered.
        const needsRule = state.groups.slice(0, gi).some((g) => g.commands.some((c) => c.enabled));
        return (
          <div key={group.id}>
            {needsRule && <div role="separator" className="my-1 h-px bg-border/70" />}
            {enabled.map((cmd) => {
              const index = items.indexOf(cmd);
              return (
                <button
                  key={cmd.id}
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => activate(cmd)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors duration-100 ${
                    index === active
                      ? cmd.destructive
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-secondary text-foreground'
                      : cmd.destructive
                        ? 'text-destructive'
                        : 'text-foreground'
                  }`}
                >
                  {cmd.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
