'use client';

import { useEffect, useRef, useState } from 'react';
import { BookJourneyEngine } from './engine';
import { BOOK_JOURNEY_STAGE_HTML } from './stage-markup';
import { bookJourneyFontVars, BOOK_JOURNEY_FONT_FAMILIES } from './fonts';
import './book-journey.css';

/**
 * BOOK JOURNEY — the React wrapper.
 *
 * This file is the whole of the "port". It owns the two elements the engine needs refs to, drops
 * in the artifact's stage markup, and drives the engine's lifecycle. It contains no animation,
 * no geometry and no choreography — all of that is `engine.js`, which is the artifact's original
 * implementation.
 *
 * The artifact ran inside a runtime (`support.js` / `DCLogic`) that supplied React, resolved
 * `{{ ref }}` bindings and owned the page. None of that comes across; a component that mounts an
 * engine in an effect and tears it down in the cleanup does the same job in ~30 lines.
 *
 * Scroll ownership: the engine binds wheel/touch/key to THIS section and consumes a gesture only
 * while the journey can still move in that direction (`canConsume`). At the first scene scrolling
 * up, or the last scrolling down, it prevents nothing and the page scrolls normally. The document
 * is never locked, so there is no state to restore and no way to trap the reader.
 */

/** The artifact's editor props, with its own defaults. Exposed so the section stays tunable. */
export type BookJourneyProps = {
  /** Scene transition speed multiplier (artifact default 1.35). */
  transitionSpeed?: number;
  /** Show the scene-progress trail on the right (artifact default true). */
  showTrail?: boolean;
  /** Falling-leaf density (artifact default 1.4). */
  leafDensity?: number;
  /** Valley mist density (artifact default 0.4). */
  mistDensity?: number;
};

const DEFAULTS: Required<BookJourneyProps> = {
  transitionSpeed: 1.35,
  showTrail: true,
  leafDensity: 1.4,
  mistDensity: 0.4,
};

export default function BookJourney(props: BookJourneyProps) {
  const pinRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InstanceType<typeof BookJourneyEngine> | null>(null);
  const [failed, setFailed] = useState(false);

  const { transitionSpeed, showTrail, leafDensity, mistDensity } = { ...DEFAULTS, ...props };

  useEffect(() => {
    if (!pinRef.current || !stageRef.current) return;

    const engine = new BookJourneyEngine({
      pinRef,
      stageRef,
      props: { transitionSpeed, showTrail, leafDensity, mistDensity },
      fonts: BOOK_JOURNEY_FONT_FAMILIES,
    });
    engineRef.current = engine;

    // The engine throwing must not take the landing page down with it. If WebGL is unavailable
    // or initialisation fails, the section keeps its sky gradient and says so, and the rest of
    // the page is untouched.
    try {
      engine.componentDidMount();
    } catch (err) {
      console.error('[book-journey] init failed', err);
      setFailed(true);
      try {
        engine.componentWillUnmount();
      } catch {
        /* teardown of a half-built engine is best-effort */
      }
      engineRef.current = null;
      return;
    }

    return () => {
      try {
        engineRef.current?.componentWillUnmount();
      } catch (err) {
        console.error('[book-journey] teardown failed', err);
      }
      engineRef.current = null;
    };
    // Mount once. The four props are forwarded live below via componentDidUpdate, which is how
    // the artifact applied them too — rebuilding the scene on a prop change would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live prop updates, matching the artifact's componentDidUpdate → applyProps path.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.props = { transitionSpeed, showTrail, leafDensity, mistDensity };
    try {
      engine.componentDidUpdate();
    } catch (err) {
      console.error('[book-journey] applyProps failed', err);
    }
  }, [transitionSpeed, showTrail, leafDensity, mistDensity]);

  return (
    <section aria-label="Malnad Stories — the journey" className={`bj-root ${bookJourneyFontVars}`}>
      {/*
        `pinRef` is THE BOX, not the full-width band. The engine binds wheel/touch/key to this
        element, so "the pointer is inside the journey" means inside the visible box — the
        breathing space beside and around it scrolls the page like any other part of the site.
        It is also the container-query container the overlays size against.
      */}
      <div
        ref={pinRef}
        // Focusable so the scoped keydown handler works without a window-level listener;
        // -1 keeps it out of the tab order.
        tabIndex={-1}
        className="bj-frame"
      >
        <div
          ref={stageRef}
          className="bj-stage"
          // See stage-markup.ts: static authored markup, injected rather than transcribed to JSX
          // so the artifact's inline styling survives byte-for-byte.
          dangerouslySetInnerHTML={{ __html: BOOK_JOURNEY_STAGE_HTML }}
        />
        {failed && (
          <p className="bj-fallback" role="status">
            The journey needs WebGL — scroll on to explore Malnad Stories.
          </p>
        )}
      </div>
    </section>
  );
}
