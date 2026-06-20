'use client';

import { Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SHORTCUTS: { label: string; keys: string }[] = [
  { label: 'Undo', keys: '⌘ Z' },
  { label: 'Redo', keys: '⌘ ⇧ Z' },
  { label: 'Save layout', keys: '⌘ S' },
  { label: 'Previous spread', keys: '←' },
  { label: 'Next spread', keys: '→' },
  { label: 'Toggle guides', keys: 'G' },
  { label: 'Keyboard shortcuts', keys: '?' },
  { label: 'Close / deselect', keys: 'Esc' },
];

/** Keyboard-shortcuts overlay (client-only; presentation). */
export default function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="animate-rise w-full max-w-md border bg-background shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-gold" />
            <h2 className="font-display text-[1.35rem] font-medium tracking-tight">Keyboard shortcuts</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <ul className="px-5 py-3">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between border-b border-border/60 py-2.5 last:border-0">
              <span className="text-sm text-foreground/80">{s.label}</span>
              <kbd className="border bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
