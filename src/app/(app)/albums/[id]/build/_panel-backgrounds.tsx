'use client';

import { Check, Ban } from 'lucide-react';
import { BACKGROUNDS } from '@/lib/builder/elements';
import type { Background } from '@/lib/builder/model';

/**
 * Backgrounds tab — pick a CSS-only page background (colour / gradient / texture) and apply
 * it to the current spread or the whole album. CSS-only by design so the PDF never waits on
 * a load. `null` = the default white paper.
 */
export default function BackgroundsPanel({
  current,
  hasTarget,
  onApply,
  onApplyAll,
}: {
  current: Background | null;
  hasTarget: boolean;
  onApply: (bg: Background | null) => void;
  onApplyAll: (bg: Background | null) => void;
}) {
  const isCurrent = (b: { key: string }) => current?.value === b.key;

  return (
    <div className="ms-scroll flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Page background</p>

      {!hasTarget && (
        <p className="rounded-xl border border-dashed bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
          Add a spread first to set a background.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        {/* None / white paper */}
        <button
          type="button"
          disabled={!hasTarget}
          onClick={() => onApply(null)}
          className={`group relative aspect-square overflow-hidden rounded-xl ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 ${
            current === null ? 'ring-2 ring-studio ring-offset-2 ring-offset-card' : 'ring-border hover:ring-studio-bright/50'
          }`}
          title="White paper (default)"
        >
          <span className="absolute inset-0 grid place-items-center bg-white text-foreground/30">
            <Ban className="h-4 w-4" />
          </span>
        </button>

        {BACKGROUNDS.map((b) => (
          <button
            key={b.key}
            type="button"
            disabled={!hasTarget}
            onClick={() => onApply({ kind: b.kind, value: b.key })}
            title={b.label}
            className={`group relative aspect-square overflow-hidden rounded-xl ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 ${
              isCurrent(b) ? 'ring-2 ring-studio ring-offset-2 ring-offset-card' : 'ring-border hover:ring-studio-bright/50'
            }`}
          >
            <span className="absolute inset-0" style={b.swatch} />
            {isCurrent(b) && (
              <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-studio text-studio-foreground shadow-sm">
                <Check className="h-2.5 w-2.5" />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/35 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] font-medium text-white">
              {b.label}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-border/70 pt-3">
        <button
          type="button"
          disabled={!hasTarget}
          onClick={() => onApplyAll(current)}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
        >
          Apply this background to all pages
        </button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          “Apply to all” uses the current spread’s background across the whole album.
        </p>
      </div>
    </div>
  );
}
