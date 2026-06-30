'use client';

import { Check, RefreshCw, X, Loader2, Wand2 } from 'lucide-react';
import Preview from './_preview';
import { Button } from '@/components/ui/button';
import { STUDIO_PRIMARY } from './_ui';
import type { Block } from '@/lib/builder/model';
import type { Photo } from './_uploader';
import type { CoverOption } from '@/lib/covers';
import { summarizePlan } from '@/lib/builder/auto-layout';

type Summary = ReturnType<typeof summarizePlan>;

/**
 * Proposal preview (Claude Design). Shows a generated layout via the SHARED _preview
 * renderer (WYSIWYG with the PDF) plus a "what was generated" summary. Nothing is
 * persisted here — Accept hands the Block[] back to the caller, which mutates Builder
 * state; the existing Save (saveLayout) is still the only persistence path.
 */
export default function Proposal({
  title,
  blocks,
  photoMap,
  cover,
  summary,
  canRegenerate,
  busy,
  acceptLabel = 'Accept layout',
  onAccept,
  onRegenerate,
  onCancel,
}: {
  title: string;
  blocks: Block[];
  photoMap: Map<string, Photo>;
  cover: CoverOption | null;
  summary: Summary;
  canRegenerate: boolean;
  busy?: boolean;
  acceptLabel?: string;
  onAccept: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}) {
  const stats: { label: string; value: number }[] = [
    { label: 'Photos analyzed', value: summary.photosAnalyzed },
    { label: 'Pages planned', value: summary.pagesPlanned },
    { label: 'Spreads created', value: summary.spreadsCreated },
    { label: 'Overlays added', value: summary.overlaysAdded },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="animate-rise flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-foreground ring-1 ring-border">
              <Wand2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Proposed layout</p>
              <h2 className="text-[1.2rem] font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Close">
            <X />
          </Button>
        </div>

        {/* Generated-album summary */}
        <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-card px-4 py-3 text-center">
              <div className="text-2xl font-semibold tabular-nums text-foreground">{s.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {summary.unplaced > 0 && (
          <p className="border-b bg-warning/[0.07] px-5 py-2 text-center text-xs text-warning">
            {summary.unplaced} photo{summary.unplaced === 1 ? '' : 's'} left in your tray — add more pages or place them by hand.
          </p>
        )}

        {/* Shared preview renderer (WYSIWYG with the PDF) */}
        <div className="flex-1 overflow-y-auto bg-secondary/20 p-4">
          <Preview blocks={blocks} photoMap={photoMap} cover={cover} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {canRegenerate && (
              <Button variant="outline" onClick={onRegenerate} disabled={busy}>
                <RefreshCw /> Regenerate
              </Button>
            )}
            <Button onClick={onAccept} disabled={busy} className={STUDIO_PRIMARY}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} {acceptLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
