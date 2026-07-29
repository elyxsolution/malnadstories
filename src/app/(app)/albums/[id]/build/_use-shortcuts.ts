'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * THE KEYBOARD SHORTCUT MANAGER — one listener, one table.
 *
 * Before this the builder had a `keydown` handler with an `if/else if` chain, and other
 * components were free to add their own. That is how shortcut conflicts appear: two listeners
 * both claim ⌘D, and which one wins depends on mount order. Here every binding is a row in one
 * declarative table, matched by a normalized key signature — so a duplicate is a visible
 * duplicate rather than an emergent bug, and the shortcuts overlay can render the same table the
 * handler dispatches from.
 *
 * PLATFORM AWARENESS. `mod` means ⌘ on Apple platforms and Ctrl elsewhere, resolved once at
 * module load. Bindings declare intent (`mod+z`), never a specific physical key, and the
 * displayed label follows automatically.
 *
 * TYPING SAFETY. While focus is in an input, textarea or contenteditable, only bindings marked
 * `allowInInput` fire — so ⌘Z inside the album-title field is the browser's undo, not the
 * builder's, and Delete removes a character rather than twelve photos.
 */

export const IS_APPLE =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

export type Shortcut = {
  /** Declarative combo, e.g. `mod+z`, `mod+shift+z`, `Delete`, `Escape`, `mod+=`. */
  combo: string;
  /** Shown in the shortcuts overlay. */
  label: string;
  group: 'Editing' | 'Selection' | 'View' | 'Navigation';
  /** Fire even while the user is typing (only ⌘S and Escape qualify). */
  allowInInput?: boolean;
  /** Return false to decline — the event then falls through to the browser. */
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;
};

/** Normalize an event into the same string space the `combo` field uses. */
function signature(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = IS_APPLE ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  // The non-mod control key still matters on Apple (Ctrl+click etc.), so it is distinct.
  if (!IS_APPLE && e.metaKey) parts.push('meta');
  if (IS_APPLE && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

/** Human label for the overlay: `mod+shift+z` → `⌘⇧Z` / `Ctrl+Shift+Z`. */
export function formatCombo(combo: string): string {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const pretty = (m: string) =>
    m === 'mod' ? (IS_APPLE ? '⌘' : 'Ctrl') : m === 'shift' ? (IS_APPLE ? '⇧' : 'Shift') : m === 'alt' ? (IS_APPLE ? '⌥' : 'Alt') : m;
  const keyLabel =
    key === 'ArrowLeft' ? '←' : key === 'ArrowRight' ? '→' : key === 'Delete' ? 'Del' : key.length === 1 ? key.toUpperCase() : key;
  return IS_APPLE ? [...mods.map(pretty), keyLabel].join('') : [...mods.map(pretty), keyLabel].join('+');
}

/**
 * Bind a shortcut table. One `keydown` listener for the whole builder, attached once; the table
 * is read through a ref so changing bindings never re-subscribes.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const ref = useRef(shortcuts);
  useEffect(() => {
    ref.current = shortcuts;
  }, [shortcuts]);

  // Aliases so a binding can be written the way people say it.
  const table = useMemo(() => {
    const map = new Map<string, Shortcut>();
    for (const s of shortcuts) map.set(s.combo, s);
    return map;
  }, [shortcuts]);
  const tableRef = useRef(table);
  useEffect(() => {
    tableRef.current = table;
  }, [table]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable;
      const sig = signature(e);
      const hit = tableRef.current.get(sig);
      if (!hit) return;
      if (typing && !hit.allowInInput) return;
      if (hit.when && !hit.when()) return;
      e.preventDefault();
      hit.run(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  return { table: shortcuts };
}
