'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * PRESS AND HOLD — one implementation, for every surface that offers it.
 *
 * A long press is not a separate event; it is a pointer-down that the user does not turn into
 * anything else in time. So the only way to recognise one is to arm a timer on pointer-down and
 * race it against travel and release — which means the code that owns the pointer has to be the
 * code that runs the race. Two surfaces in this builder own pointers on a photo (the \`Movable\`
 * that carries an overlay, and the base slot on the page), and they must agree on what counts as
 * a hold or the gesture would feel different depending on which frame you touched.
 *
 * THRESHOLDS. 480ms is the interval a deliberate hold clears and an ordinary click does not —
 * comfortably past a click and a double-click, comfortably short of feeling stuck. 8px of travel
 * is roughly a fingertip's tremor: enough that a steady hold on a touchscreen survives it, tight
 * enough that anything meant as a drag cancels the press on its first frame.
 *
 * The press is abandoned by movement past the slop, by release, by cancellation and by unmount.
 * A timer that survived any of those would open an editing mode after the customer had already
 * moved on to something else.
 */

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP_PX = 8;

type Point = { clientX: number; clientY: number };

export function useLongPress(handler: (() => void) | undefined) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** The press won. Consumed by the host to suppress whatever the browser makes of the same hold. */
  const fired = useRef(false);

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  /**
   * Arm on pointer-down. `beforeFire` is the host's teardown — the pointer is still down when the
   * press wins, so whatever gesture was provisionally in flight has to be abandoned before the
   * handler opens something on top of it.
   */
  const arm = useCallback(
    (e: Point, beforeFire?: () => void) => {
      cancel();
      fired.current = false;
      if (!handlerRef.current) return;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;
        fired.current = true;
        beforeFire?.();
        handlerRef.current?.();
      }, LONG_PRESS_MS);
    },
    [cancel],
  );

  /** Call on every pointer-move: past the slop this is a drag, not a press. */
  const track = useCallback(
    (e: Point) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > LONG_PRESS_SLOP_PX) cancel();
    },
    [cancel],
  );

  /** True exactly once after the press fires — reading it clears the flag. */
  const consumeFired = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return { arm, track, cancel, consumeFired };
}
