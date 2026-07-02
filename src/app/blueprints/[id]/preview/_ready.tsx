'use client';

import { useEffect } from 'react';

/**
 * Sets `window.__BLUEPRINT_PREVIEW_READY = true` once fonts have settled, so the worker's
 * Puppeteer screenshot fires on a fully-painted page (parallel to album-print's readiness flag).
 * Blueprint previews have no photo images (empty slots) — only CSS + optional stickers — so a
 * short font-settle is sufficient; a cap guarantees the flag is always set.
 */
export default function PreviewReady() {
  useEffect(() => {
    let done = false;
    const mark = () => {
      if (done) return;
      done = true;
      (window as unknown as { __BLUEPRINT_PREVIEW_READY?: boolean }).__BLUEPRINT_PREVIEW_READY = true;
    };
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).then(() => requestAnimationFrame(mark));
    const cap = setTimeout(mark, 4000);
    return () => clearTimeout(cap);
  }, []);
  return null;
}
