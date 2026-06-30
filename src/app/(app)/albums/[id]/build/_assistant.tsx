'use client';

import {
  Sparkles,
  X,
  LayoutGrid,
  ImagePlus,
  CalendarRange,
  Shuffle,
  ArrowRight,
  Type as TypeIcon,
  BookImage,
  Palette,
  Loader2,
} from 'lucide-react';
import { Sprig } from '@/components/brand';

export type AssistKind = 'build' | 'fill' | 'date' | 'suggest';

/**
 * AI Assistant — the builder's intelligence surface. Today it runs DETERMINISTIC,
 * rule-based helpers (auto-arrange, fill, organise, restructure); every action only
 * proposes — the user previews and approves, and nothing persists until the existing
 * Save runs. The panel is also the architecture seam for upcoming generative features
 * (captions, cover titles, background recommendations) which slot into the same list.
 *
 * Warm editorial styling with the builder's forest-green accent; gold stays a whisper.
 */

type SmartAction = {
  kind: AssistKind;
  icon: typeof LayoutGrid;
  title: string;
  desc: string;
  cta: string;
  disabled: boolean;
};

/** Capabilities the panel is architected for but that aren't generative yet. */
type FutureCapability = { icon: typeof TypeIcon; title: string; desc: string };

const FUTURE: FutureCapability[] = [
  { icon: TypeIcon, title: 'Caption generation', desc: 'Draft a caption for each spread from the moment it shows.' },
  { icon: BookImage, title: 'Cover title ideas', desc: 'Suggest a title and subtitle that fit your trip.' },
  { icon: Palette, title: 'Background recommendations', desc: 'Pick palettes and textures that suit your photos.' },
];

export default function Assistant({
  onAction,
  onClose,
  photoCount,
  availableCount,
  hasLayout,
  busy = false,
}: {
  onAction: (kind: AssistKind) => void;
  onClose: () => void;
  photoCount: number;
  availableCount: number;
  hasLayout: boolean;
  busy?: boolean;
}) {
  const actions: SmartAction[] = [
    {
      kind: 'build',
      icon: LayoutGrid,
      title: 'Auto-arrange my album',
      desc: 'Lay out all your photos into a complete album — paired and spread by orientation, ordered by the day they were taken.',
      cta: 'Generate layout',
      disabled: photoCount === 0,
    },
    {
      kind: 'fill',
      icon: ImagePlus,
      title: 'Complete the empty frames',
      desc: 'Drop your unplaced photos into the open frames on the pages you’ve already laid out.',
      cta: 'Preview fill',
      disabled: !hasLayout || availableCount === 0,
    },
    {
      kind: 'date',
      icon: CalendarRange,
      title: 'Organise by date',
      desc: 'Reorder your spreads to follow the trip’s timeline, earliest first.',
      cta: 'Preview order',
      disabled: !hasLayout,
    },
    {
      kind: 'suggest',
      icon: Shuffle,
      title: 'Recommend another layout',
      desc: 'Try a different arrangement of the same photos — deterministic, never random.',
      cta: 'Suggest a layout',
      disabled: photoCount === 0,
    },
  ];

  return (
    <>
      <div className="animate-fade-in fixed inset-0 z-[55] bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Smart layout"
        aria-modal="true"
        className="animate-rise fixed inset-y-0 right-0 z-[56] flex w-[396px] max-w-[92vw] flex-col bg-background shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-studio text-studio-foreground shadow-soft">
              <Sparkles className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Smart layout</p>
              <h2 className="text-[1.3rem] font-semibold leading-tight tracking-tight text-foreground">Let’s shape your album.</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="border-b bg-secondary/30 px-6 py-3 text-[13px] leading-relaxed text-muted-foreground">
          Every suggestion opens a preview first — nothing changes until you approve it.{' '}
          <span className="font-medium text-foreground">{photoCount} photo{photoCount === 1 ? '' : 's'}</span> ready.
        </p>

        <div className="ms-scroll flex-1 overflow-y-auto p-5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Smart actions</p>
          <div className="space-y-2.5">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.kind} className="rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-card">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-studio/10 text-studio">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="text-[15px] font-semibold tracking-tight">{a.title}</h3>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{a.desc}</p>
                  <button
                    type="button"
                    onClick={() => onAction(a.kind)}
                    disabled={a.disabled || busy}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-studio px-3.5 py-2 text-[12.5px] font-medium text-studio transition-colors duration-150 ease-glide hover:bg-studio-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {a.cta} {!busy && <ArrowRight className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Future capabilities — architecture seam, clearly signalled as upcoming. */}
          <div className="mt-6 flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Coming soon</p>
            <span className="h-px flex-1 bg-border/70" />
          </div>
          <div className="mt-3 space-y-2">
            {FUTURE.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex items-start gap-3 rounded-xl border border-dashed border-border/80 bg-secondary/20 p-3">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[13px] font-semibold tracking-tight text-foreground">{f.title}</h4>
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold">Soon</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="flex items-center gap-2 border-t px-6 py-3.5 text-[13px] text-muted-foreground">
          <Sprig className="h-3.5 w-3.5 text-muted-foreground" /> Suggested by Malnad — the final say is always yours.
        </p>
      </aside>
    </>
  );
}
