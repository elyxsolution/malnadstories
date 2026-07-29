'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Command } from './_use-commands';
import { STUDIO_PRIMARY } from './_ui';

/**
 * THE SELECTION BAR — the visible home for bulk actions.
 *
 * Multi-selection is only useful if there is somewhere to act on it. This appears when two or
 * more things are selected and disappears the moment they aren't, so a single-item edit still
 * sees exactly the interface it always did.
 *
 * It renders COMMANDS, like the context menu does — the same objects, the same labels, the same
 * enablement. A button here and its keyboard shortcut cannot diverge, because they are the same
 * `run()`.
 *
 * Placement is bottom-centre over the canvas, out of the way of both rails, and it announces
 * itself politely rather than stealing focus.
 */
export default function SelectionBar({
  count,
  commands,
  primaryLabel,
  onPrimary,
  onDismiss,
}: {
  count: number;
  /** Bulk actions, already filtered to what is relevant. Disabled ones are not rendered. */
  commands: Command[];
  /** Optional emphasised action (Batch replace, when empty frames are selected). */
  primaryLabel?: string;
  onPrimary?: () => void;
  onDismiss: () => void;
}) {
  if (count < 2) return null;
  const usable = commands.filter((c) => c.enabled);

  return (
    <div
      role="toolbar"
      aria-label={`${count} items selected`}
      className="motion-safe:animate-scale-in pointer-events-auto absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-border/80 bg-card/95 px-2 py-1.5 shadow-elevated backdrop-blur-sm"
    >
      <span aria-live="polite" className="px-1.5 text-[12px] font-medium tabular-nums text-foreground">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border" aria-hidden />

      {primaryLabel && onPrimary && (
        <Button size="sm" className={STUDIO_PRIMARY} onClick={onPrimary}>
          {primaryLabel}
        </Button>
      )}

      {usable.map((cmd) => (
        <Button
          key={cmd.id}
          size="sm"
          variant="ghost"
          onClick={() => void cmd.run()}
          className={cmd.destructive ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground' : ''}
        >
          {cmd.label}
        </Button>
      ))}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Clear selection"
        className="ml-0.5 grid h-6 w-6 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
