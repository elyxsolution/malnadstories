'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

/**
 * THE ONE SCROLL-REVEAL PRIMITIVE for the public site.
 *
 * WHY THIS AND NOT A MOTION LIBRARY. The project's motion system is CSS: `ease-premium`
 * (`cubic-bezier(0.32, 0.72, 0, 1)` — a strong decelerate, the curve the builder and the auth
 * screens already use), `ease-glide`, and the `fade-in` / `rise` / `scale-in` keyframes in
 * `tailwind.config.ts`. Adding a runtime animation library would have made every revealed
 * section a Client Component and shipped ~34 KB to pages that are otherwise static. This is one
 * tiny client leaf instead: the SECTIONS stay Server Components and only their wrapper hydrates.
 *
 * ONE OBSERVER PER ELEMENT, FIRED ONCE. `IntersectionObserver`, disconnected the moment the
 * element is shown — no scroll listener, no rAF loop, no work after the reveal. Re-animating on
 * every scroll-past is exactly the "animation showcase" quality this design is trying not to be.
 *
 * WHAT IT ANIMATES: `opacity` and `translateY` only — both compositor properties, so no layout or
 * paint. Never width/height/top/left.
 *
 * THE IDLE STATE IS SERVER-RENDERED, AND THAT IS DELIBERATE — with a matching escape hatch.
 * `data-reveal="idle"` (opacity 0) is present in the HTML the server sends. It has to be: the
 * alternative is to add it on the client, which means the content paints at full opacity and then
 * vanishes the moment hydration catches up. So the initial hidden state ships, and TWO CSS rules
 * in globals.css make sure it can never strand a reader:
 *   · `@media (scripting: none)` — with JavaScript unavailable the reveal system is inert and
 *     every element is simply visible, so a no-JS reader or a non-executing crawler gets the page;
 *   · `@media (prefers-reduced-motion: reduce)` — same, for anyone who has asked for less motion.
 *
 * An element that is never scrolled to stays hidden, which is the intended behaviour rather than a
 * gap: it is also never seen. Anything at or near the viewport fires on `observe()` immediately,
 * so above-the-fold content does not wait for a scroll event that may never come.
 *
 * REDUCED MOTION is handled in CSS (globals.css), not in JS, so it responds to the user changing
 * the setting without a reload and cannot be missed by a code path.
 */

type RevealProps = {
  children: ReactNode;
  /** Element to render. Sections pass their own semantic tag. */
  as?: ElementType;
  className?: string;
  /**
   * Delay in ms, for deliberate grouping only (a heading before its grid). Keep small — 60–120ms
   * reads as "these belong together"; anything longer reads as a queue the reader is waiting on.
   */
  delay?: number;
  /**
   * How far the element travels. `sm` for text and controls, `md` (default) for sections and
   * media. Deliberately not a free number: three options is a system, an arbitrary pixel value
   * is a magic number in every call site.
   */
  distance?: 'none' | 'sm' | 'md';
};

export default function Reveal({ children, as, className = '', delay = 0, distance = 'md' }: RevealProps) {
  const Tag = (as ?? 'div') as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer support (or a very old browser): show immediately rather than never.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    // Already on screen at mount — above-the-fold content must not wait for a scroll event that
    // may never come.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          io.disconnect(); // once. no repeated work for the rest of the session.
        }
      },
      // Fire a little before the element's edge reaches the viewport, so the motion completes as
      // it arrives rather than starting after the reader is already looking at it.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal={shown ? 'shown' : 'idle'}
      data-reveal-distance={distance}
      // The delay is only ever applied to the ENTER. Once shown it is cleared, so a later
      // transition on the same element (a hover, say) is not delayed by a stale value.
      style={delay && !shown ? { transitionDelay: `${delay}ms` } : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}
