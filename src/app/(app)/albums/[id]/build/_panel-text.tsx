'use client';

import { Heading, Type, AlignLeft } from 'lucide-react';
import type { TextVariant } from '@/lib/builder/model';

const OPTIONS: { variant: TextVariant; label: string; hint: string; preview: string; className: string; Icon: typeof Type }[] = [
  { variant: 'heading', label: 'Heading', hint: 'A large title', preview: 'Your headline', className: 'font-display text-2xl font-semibold', Icon: Heading },
  { variant: 'subtitle', label: 'Subtitle', hint: 'A small label', preview: 'A SUBTITLE', className: 'font-ui text-sm font-medium uppercase tracking-[0.12em]', Icon: Type },
  { variant: 'paragraph', label: 'Body text', hint: 'A few sentences', preview: 'Add a few words to tell the story…', className: 'font-ui text-[13px]', Icon: AlignLeft },
];

/** Text tab — add a heading / subtitle / paragraph to the current spread, then style it in the inspector. */
export default function TextPanel({ hasTarget, onAdd }: { hasTarget: boolean; onAdd: (variant: TextVariant) => void }) {
  return (
    <div className="ms-scroll flex-1 space-y-3 overflow-y-auto p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Add text</p>
      {OPTIONS.map((o) => (
        <button
          key={o.variant}
          type="button"
          disabled={!hasTarget}
          onClick={() => onAdd(o.variant)}
          className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio-bright/50 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-studio/10 text-studio">
            <o.Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-foreground ${o.className}`}>{o.preview}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{o.label} · {o.hint}</span>
          </span>
        </button>
      ))}
      {!hasTarget && <p className="text-center text-[11px] text-muted-foreground">Add a spread first to place text.</p>}
      <p className="rounded-xl bg-secondary/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Tip: double-click any text on the page to edit it. Select it to change font, size, colour and more.
      </p>
    </div>
  );
}
