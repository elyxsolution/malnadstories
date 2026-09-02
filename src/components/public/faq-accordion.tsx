'use client';

import { useId, useState } from 'react';
import { Plus } from 'lucide-react';

export type FaqItem = { question: string; answer: string; category?: string | null };

/**
 * FAQ DISCLOSURE LIST.
 *
 * THE HEIGHT ANIMATION USES `grid-template-rows: 0fr → 1fr`, not `height: 0 → auto`.
 * `auto` is not an animatable value, so the usual workarounds are a hardcoded max-height (which
 * clips long answers, and animates a lie) or measuring the panel in JavaScript on every open
 * (which reads layout mid-interaction). The `fr` trick animates a single grid track between two
 * real values, so any length of answer opens correctly, at the right speed, with no measurement
 * and no clipping.
 *
 * `grid-template-rows` is not a compositor property, so this DOES cost layout — which is the one
 * deliberate exception on the public site. It is confined to a single small element, it runs only
 * on a direct user action, and the alternatives are worse. Everything else animated on these
 * pages is `transform` + `opacity` only.
 *
 * ACCESSIBILITY. A real `<button>` per row inside its own heading, `aria-expanded`, and
 * `aria-controls` pointing at a region labelled by the button — so a screen reader announces the
 * state and can jump between questions. Keyboard behaviour is the browser's own: Tab moves,
 * Enter/Space toggles. Nothing here depends on hover.
 *
 * The panel is `hidden` from assistive tech while collapsed via `inert`-like semantics: it is
 * kept in the DOM (so the animation has something to animate) but `invisible` once closed, which
 * removes its content from the tab order.
 */
export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const baseId = useId();
  // Single-open. A page of simultaneously-open answers is a page you have to re-scan; opening one
  // question is almost always the whole intent.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-border">
      {items.map((item, i) => {
        const open = openIndex === i;
        const buttonId = `${baseId}-q${i}`;
        const panelId = `${baseId}-a${i}`;
        return (
          <div key={item.question} className="border-b border-border">
            <h3>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenIndex(open ? null : i)}
                className="group flex w-full items-start justify-between gap-6 py-6 text-left transition-colors duration-150 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="font-display text-lg font-normal leading-snug tracking-tight text-primary transition-colors group-hover:text-gold sm:text-xl">
                  {item.question}
                </span>
                {/* A plus that becomes a minus. Rotation is cheap, communicates the state without
                    a second icon, and reads as the same object changing rather than swapping. */}
                <Plus
                  aria-hidden
                  className={`mt-1 h-5 w-5 flex-none text-muted-foreground transition-transform duration-300 ease-premium motion-reduce:transition-none ${
                    open ? 'rotate-45' : ''
                  }`}
                />
              </button>
            </h3>

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-premium motion-reduce:transition-none ${
                open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className={`overflow-hidden transition-[opacity] duration-200 ${open ? 'opacity-100' : 'invisible opacity-0'}`}
              >
                <p className="pb-7 pr-10 text-[15px] font-light leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
