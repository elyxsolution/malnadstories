'use client';

import { Wand2, X, LayoutGrid, ImagePlus, CalendarRange, Shuffle, ArrowRight } from 'lucide-react';
import { Sprig } from '@/components/brand';

export type AssistKind = 'build' | 'fill' | 'date' | 'suggest';

/**
 * Layout assistant (Claude Design) — a RULE-BASED helper, not AI. It only proposes;
 * every action opens a preview the user must accept, and nothing persists until the
 * existing Save runs. Warm editorial styling with forest + gold accents.
 */
export default function Assistant({
  onAction,
  onClose,
  photoCount,
  availableCount,
  hasLayout,
}: {
  onAction: (kind: AssistKind) => void;
  onClose: () => void;
  photoCount: number;
  availableCount: number;
  hasLayout: boolean;
}) {
  const actions: { kind: AssistKind; icon: typeof LayoutGrid; title: string; desc: string; cta: string; disabled: boolean }[] = [
    {
      kind: 'build',
      icon: LayoutGrid,
      title: 'Build my album',
      desc: 'Arrange all your photos into a complete album — paired and spread by orientation, ordered by the day they were taken.',
      cta: 'Generate layout',
      disabled: photoCount === 0,
    },
    {
      kind: 'fill',
      icon: ImagePlus,
      title: 'Fill empty frames',
      desc: 'Drop your unplaced photos into the open frames on the pages you’ve already laid out.',
      cta: 'Preview fill',
      disabled: !hasLayout || availableCount === 0,
    },
    {
      kind: 'date',
      icon: CalendarRange,
      title: 'Organize by date',
      desc: 'Reorder your spreads to follow the trip’s timeline, earliest first.',
      cta: 'Preview order',
      disabled: !hasLayout,
    },
    {
      kind: 'suggest',
      icon: Shuffle,
      title: 'Suggest another structure',
      desc: 'Try a different deterministic arrangement of the same photos — no two passes are random.',
      cta: 'Suggest a layout',
      disabled: photoCount === 0,
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside className="animate-rise fixed inset-y-0 right-0 z-[56] flex w-[380px] max-w-[92vw] flex-col bg-background shadow-elevated">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
              <Wand2 className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Layout assistant</p>
              <h2 className="font-display text-[1.5rem] font-normal leading-tight text-primary">Let me help arrange it.</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="border-b bg-secondary/30 px-6 py-3 text-[13px] leading-relaxed text-muted-foreground">
          I’ll suggest an arrangement — but nothing changes until you preview and approve it. {photoCount} photo
          {photoCount === 1 ? '' : 's'} ready.
        </p>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.kind} className="rounded-2xl border bg-card p-4 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-[15px] font-semibold tracking-tight">{a.title}</h3>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{a.desc}</p>
                <button
                  type="button"
                  onClick={() => onAction(a.kind)}
                  disabled={a.disabled}
                  className="mt-3 inline-flex items-center gap-2 border border-primary px-3.5 py-2 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/[0.06] disabled:pointer-events-none disabled:opacity-40"
                >
                  {a.cta} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <p className="flex items-center gap-2 border-t px-6 py-3.5 font-display text-[13px] italic text-muted-foreground">
          <Sprig className="h-3.5 w-3.5 not-italic text-gold" /> Suggested by Malnad — the final say is always yours.
        </p>
      </aside>
    </>
  );
}
