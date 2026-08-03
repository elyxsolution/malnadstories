'use client';

import { Check } from 'lucide-react';
import { WIZARD_STEPS } from '@/lib/wizard/steps';

/**
 * THE album-flow progress indicator. One component, driven entirely by `WIZARD_STEPS`,
 * rendered in two places: the creation wizard (brand tone) and the builder's header
 * (studio tone). It replaces the two independently-maintained step arrays those files
 * used to carry.
 *
 * With only two steps there is room to make the connector do real work: it fills from
 * left to right as you advance, which reads as progress rather than as decoration. The
 * fill is a `scaleX` on an inner span (transform-only, origin-left) so nothing lays out
 * during the transition.
 */

type Tone = 'brand' | 'studio';

const TONE: Record<Tone, { done: string; active: string; idle: string; rule: string; activeText: string }> = {
  brand: {
    done: 'border-primary bg-primary text-primary-foreground',
    active: 'border-primary bg-primary text-primary-foreground',
    idle: 'border-border bg-background text-muted-foreground',
    rule: 'bg-primary',
    activeText: 'text-foreground',
  },
  studio: {
    done: 'border-transparent bg-studio text-studio-foreground',
    active: 'border-studio/30 bg-studio/[0.12] text-studio',
    idle: 'border-border bg-secondary text-muted-foreground/70',
    rule: 'bg-studio',
    activeText: 'text-foreground',
  },
};

export default function WizardProgress({
  current,
  tone = 'brand',
  className = '',
}: {
  /** Zero-based index of the step the user is on. */
  current: number;
  tone?: Tone;
  className?: string;
}) {
  const t = TONE[tone];

  return (
    <ol className={`flex items-center ${className}`} aria-label="Album creation progress">
      {WIZARD_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const isLast = i === WIZARD_STEPS.length - 1;

        return (
          <li key={step.key} className="flex items-center">
            <span className="flex items-center gap-2.5" aria-current={active ? 'step' : undefined}>
              <span
                className={`grid h-6 w-6 flex-none place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors duration-200 ease-glide ${
                  done ? t.done : active ? t.active : t.idle
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="flex flex-col leading-none">
                <span
                  className={`text-[13px] tracking-tight transition-colors duration-200 ${
                    active ? `font-semibold ${t.activeText}` : done ? 'text-foreground/70' : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
                {active && (
                  <span className="mt-1 hidden text-[11px] text-muted-foreground lg:block">{step.hint}</span>
                )}
              </span>
            </span>

            {!isLast && (
              <span aria-hidden className="mx-3 h-px w-10 overflow-hidden rounded-full bg-border sm:w-14">
                <span
                  className={`block h-full w-full origin-left transition-transform duration-500 ease-glide ${t.rule}`}
                  style={{ transform: `scaleX(${done ? 1 : 0})` }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
