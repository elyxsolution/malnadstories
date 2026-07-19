'use client';

import { useEffect, useRef, useState } from 'react';
import { LoadingConfig } from './loading-config';

/**
 * useDelayedLoading — THE shared timing engine for every loader (overlay + button). Given a live
 * `active` flag it returns:
 *   • mounted — keep the loader in the DOM (true from just-before-appear through the fade-out).
 *   • shown   — the "opacity/scale on" flag (drives the fade transition).
 *
 * Behaviour (all timings from LoadingConfig):
 *   • Appears only after `loadingDelay` → a fast op (active flips off first) never flashes.
 *   • Once shown, stays ≥ `minimumVisibleDuration`, then fades out over `overlayFadeDuration`.
 * All timers are tracked and cleared on every change + unmount (no leaks). Reads mount/shown
 * state via refs so the effect keys only on `active` (no re-render loops).
 */
export function useDelayedLoading(active: boolean): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const mountedRef = useRef(false);
  const shownAt = useRef<number | null>(null);
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafs = useRef<number[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
      rafs.current.forEach((r) => cancelAnimationFrame(r));
    };
  }, []);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      rafs.current.forEach((r) => cancelAnimationFrame(r));
      rafs.current = [];
    };
    clear();

    if (active) {
      // Schedule appearance after the delay (fast ops flip `active` off before this fires).
      const t = setTimeout(() => {
        if (!alive.current) return;
        mountedRef.current = true;
        shownAt.current = Date.now();
        setMounted(true);
        // Next frame → opacity/scale on, so the mount→shown transition actually animates.
        const raf = requestAnimationFrame(() => alive.current && setShown(true));
        rafs.current.push(raf);
      }, LoadingConfig.loadingDelay);
      timers.current.push(t);
    } else if (mountedRef.current) {
      // Currently visible → honour the minimum duration, then fade out, then unmount.
      const elapsed = shownAt.current ? Date.now() - shownAt.current : 0;
      const wait = Math.max(0, LoadingConfig.minimumVisibleDuration - elapsed);
      const t1 = setTimeout(() => {
        if (!alive.current) return;
        setShown(false); // begin fade-out
        const t2 = setTimeout(() => {
          if (!alive.current) return;
          mountedRef.current = false;
          shownAt.current = null;
          setMounted(false);
        }, LoadingConfig.overlayFadeDuration);
        timers.current.push(t2);
      }, wait);
      timers.current.push(t1);
    } else {
      // Never appeared (op finished within the delay) — ensure we stay hidden.
      setShown(false);
    }

    return clear;
  }, [active]);

  return { mounted, shown };
}

/**
 * useRotatingMessage — rotates through `messages` every `messageRotationInterval` while active.
 * Falls back to `label` then the config default. One interval, cleaned on change/unmount.
 */
export function useRotatingMessage(messages: readonly string[] | null | undefined, label?: string): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (!messages || messages.length <= 1) return;
    const id = setInterval(() => setI((x) => (x + 1) % messages.length), LoadingConfig.messageRotationInterval);
    return () => clearInterval(id);
  }, [messages]);
  if (messages && messages.length) return messages[i % messages.length];
  return label ?? LoadingConfig.defaultMessage;
}
