import type { SVGProps } from 'react';

/**
 * Malnad Stories signature elements, shared across the premium customer surfaces
 * (Builder + the purchase journey).
 *
 * `Sprig` — a hand-drawn two-leaf sprig (the lush Malnad / Western Ghats greenery),
 * used sparingly as the brand mark. `LUX_PRIMARY` — the crafted forest-green CTA
 * surface (embossed top highlight + layered green shadow; one same-hue depth
 * gradient, never a loud rainbow). `CompletionSeal` — the wax-seal moment that
 * presses in at a milestone (album complete; order confirmed).
 */

export function Sprig({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      {/* stem */}
      <path d="M12 22 C 12 17 12 13 12 9" />
      {/* right leaf */}
      <path d="M12 13 C 14 9.5 17 7.5 20 6.5 C 18.5 10 16 12.5 12 13 Z" fill="currentColor" stroke="none" />
      {/* left leaf */}
      <path d="M12 16 C 10 12.5 7 10.5 4 9.5 C 5.5 13 8 15.5 12 16 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Crafted primary CTA. Passed as `className` to <Button>; tailwind-merge lets these
// arbitrary background/shadow utilities override the stock `bg-primary shadow-sm`.
export const LUX_PRIMARY =
  'border-transparent text-primary-foreground ' +
  'bg-[linear-gradient(180deg,hsl(158_38%_27%),hsl(158_42%_19%))] ' +
  'shadow-[inset_0_1px_0_0_hsl(150_50%_62%/0.28),0_1px_2px_rgb(16_24_20/0.3),0_8px_18px_-8px_hsl(158_45%_18%/0.55)] ' +
  'hover:bg-[linear-gradient(180deg,hsl(158_40%_29%),hsl(158_44%_20%))] ' +
  'hover:shadow-[inset_0_1px_0_0_hsl(150_50%_64%/0.34),0_2px_5px_rgb(16_24_20/0.32),0_12px_26px_-8px_hsl(158_45%_18%/0.62)]';

export function CompletionSeal({
  title = 'Your story is ready',
  subtitle = 'Ready to print',
}: {
  title?: string;
  subtitle?: string;
} = {}) {
  return (
    <div className="animate-scale-in flex shrink-0 items-center gap-2.5 rounded-full border border-primary/20 bg-primary/[0.06] py-1.5 pl-2 pr-4">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(158_38%_27%),hsl(158_42%_19%))] text-primary-foreground shadow-[inset_0_1px_0_0_hsl(150_50%_62%/0.3)] ring-2 ring-primary/15">
        <Sprig className="h-[18px] w-[18px]" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="font-display text-[13px] font-semibold tracking-tight text-primary">{title}</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-primary/55">{subtitle}</span>
      </span>
    </div>
  );
}

/**
 * A large pressed wax-seal medallion for milestone moments (order confirmed).
 * Bigger, ceremonial sibling of CompletionSeal — used as a hero mark.
 */
export function SealMedallion({ className }: { className?: string }) {
  return (
    <span
      className={`grid h-16 w-16 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(158_38%_27%),hsl(158_42%_19%))] text-primary-foreground shadow-[inset_0_1px_0_0_hsl(150_50%_62%/0.35),0_10px_24px_-8px_hsl(158_45%_18%/0.5)] ring-4 ring-primary/10 ${className ?? ''}`}
    >
      <Sprig className="h-8 w-8" />
    </span>
  );
}
