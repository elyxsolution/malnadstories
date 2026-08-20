'use client';

import dynamic from 'next/dynamic';
import './book-journey.css';

/**
 * BOOK JOURNEY — mount point.
 *
 * `src/app/page.tsx` stays a Server Component (it still does its ISR data fetching), so the
 * `ssr: false` dynamic import has to happen in a client boundary — this file is that boundary and
 * nothing else. It exists to keep three.js out of the server render and off the initial bundle:
 * the WebGL engine is ~600 KB of JavaScript that the landing page must not block on.
 *
 * The placeholder is the reason there is no black rectangle at any point. It is the same height
 * as the real section and carries the SAME sky gradient the scene opens on, so the first paint is
 * already the journey's sky; the WebGL canvas then fades in over it. Nothing is delayed
 * artificially — the chunk is requested immediately on hydration.
 */
const BookJourney = dynamic(() => import('./book-journey'), {
  ssr: false,
  loading: () => (
    <div className="bj-root" aria-hidden>
      <div className="bj-stage">
        <div className="bj-mount" />
      </div>
    </div>
  ),
});

export default BookJourney;
