'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, ServerCog } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Worker readiness gate (Phase G, Parts 3–6).
 *
 * Wrap any worker-dependent action with `ensureReady()`: it probes our own
 * `/api/worker/health` route (worker URL stays server-side) and
 *   - resolves `true` immediately if the worker is already awake, OR
 *   - opens a blocking modal, wakes the worker by polling every 5s for up to 90s
 *     with a live elapsed timer, then resolves `true` (after a brief success state)
 *     so the caller can transparently continue the original operation, OR
 *   - on timeout, shows a failure state with Retry / Cancel and resolves only when
 *     the user decides (`true` after a successful retry, `false` on cancel).
 *
 * Usage:
 *   const { ensureReady, modal } = useWorkerGate();
 *   const run = async () => { if (await ensureReady()) doWorkerThing(); };
 *   return (<>… {modal}</>);
 */

const PROBE_TIMEOUT_MS = 8000; // route does a ~4s upstream probe; allow round-trip slack
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 90_000;
const SUCCESS_HOLD_MS = 1100;

type Phase = 'idle' | 'waking' | 'success' | 'failed';
type FailReason = 'timeout' | 'misconfigured';
type Probe = { ready: true } | { ready: false; reason: 'unreachable' | 'misconfigured' };

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * One probe of our health route. A 429/5xx/timeout is treated as 'unreachable' (worth
 * waking); the route only reports 'misconfigured' for a broken-deploy WORKER_URL.
 */
async function probeOnce(): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/worker/health', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return { ready: false, reason: 'unreachable' };
    const body = (await res.json().catch(() => null)) as Probe | null;
    if (body?.ready === true) return { ready: true };
    return { ready: false, reason: body?.reason === 'misconfigured' ? 'misconfigured' : 'unreachable' };
  } catch {
    return { ready: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export function useWorkerGate() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [failReason, setFailReason] = useState<FailReason>('timeout');

  // Resolves the user's choice while parked in the 'failed' state.
  const decisionRef = useRef<((d: 'retry' | 'cancel') => void) | null>(null);
  // Set when the user cancels mid-wake; checked between probes to bail out fast.
  const cancelledRef = useRef(false);

  const settleDecision = (d: 'retry' | 'cancel') => {
    decisionRef.current?.(d);
    decisionRef.current = null;
  };

  const onCancel = useCallback(() => {
    cancelledRef.current = true;
    settleDecision('cancel');
  }, []);

  const onRetry = useCallback(() => {
    settleDecision('retry');
  }, []);

  const ensureReady = useCallback(async (): Promise<boolean> => {
    cancelledRef.current = false;

    // Fast path: already awake → no modal, continue immediately.
    let probe = await probeOnce();
    if (probe.ready) return true;

    // Each pass either tries to WAKE the worker (it's reachable-but-asleep) or, when
    // the deploy is MISCONFIGURED (prod with a bad/missing WORKER_URL — fail-closed),
    // skips straight to the error state since polling can't help. We park in 'failed'
    // and resolve only on the user's Retry/Cancel.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!probe.ready && probe.reason === 'unreachable') {
        setPhase('waking');
        setElapsed(0);
        const start = Date.now();
        const ticker = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

        let result: Probe = probe;
        try {
          while (Date.now() - start < MAX_WAIT_MS) {
            if (cancelledRef.current) {
              setPhase('idle');
              return false;
            }
            result = await probeOnce();
            if (result.ready || result.reason === 'misconfigured') break;
            // Interruptible wait so Cancel responds within a fraction of a second.
            const ok = await waitOrCancel(POLL_INTERVAL_MS, cancelledRef);
            if (!ok) {
              setPhase('idle');
              return false;
            }
          }
        } finally {
          clearInterval(ticker);
        }

        if (result.ready) {
          setPhase('success');
          await new Promise((r) => setTimeout(r, SUCCESS_HOLD_MS));
          setPhase('idle');
          return true;
        }
        probe = result;
        setFailReason(result.reason === 'misconfigured' ? 'misconfigured' : 'timeout');
      } else {
        // Misconfigured: waking is futile — show a clear, immediate error.
        setFailReason('misconfigured');
      }

      setPhase('failed');
      const decision = await new Promise<'retry' | 'cancel'>((resolve) => {
        decisionRef.current = resolve;
      });
      if (decision === 'cancel') {
        setPhase('idle');
        return false;
      }
      cancelledRef.current = false; // retry: re-probe and loop
      probe = await probeOnce();
      if (probe.ready) {
        setPhase('success');
        await new Promise((r) => setTimeout(r, SUCCESS_HOLD_MS));
        setPhase('idle');
        return true;
      }
    }
  }, []);

  const modal = phase === 'idle' ? null : (
    <WorkerWakeModal phase={phase} elapsed={elapsed} failReason={failReason} onRetry={onRetry} onCancel={onCancel} />
  );

  return { ensureReady, modal };
}

/** Resolves true after `ms`, or false early if cancellation is requested. */
function waitOrCancel(ms: number, cancelledRef: { current: boolean }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (cancelledRef.current) {
        clearInterval(id);
        resolve(false);
      } else if (Date.now() - start >= ms) {
        clearInterval(id);
        resolve(true);
      }
    }, 200);
  });
}

function WorkerWakeModal({
  phase,
  elapsed,
  failReason,
  onRetry,
  onCancel,
}: {
  phase: Exclude<Phase, 'idle'>;
  elapsed: number;
  failReason: FailReason;
  onRetry: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Preparing photo processing service"
    >
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 text-center shadow-lg">
        {phase === 'waking' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ServerCog className="h-6 w-6 animate-pulse text-primary" />
            </div>
            <h2 className="mt-4 text-base font-semibold">Preparing photo processing service</h2>
            <p className="mt-1 text-sm text-muted-foreground">Starting image processor…</p>

            <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono tabular-nums">{fmt(elapsed)}</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-[worker-wake_1.4s_ease-in-out_infinite] rounded bg-primary" />
            </div>

            <p className="mt-4 text-xs text-muted-foreground">This usually takes less than one minute.</p>
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {phase === 'success' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-base font-semibold">Image processor ready</h2>
            <p className="mt-1 text-sm text-muted-foreground">Continuing…</p>
          </>
        )}

        {phase === 'failed' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="mt-4 text-base font-semibold">
              {failReason === 'misconfigured' ? 'Photo processing unavailable' : 'Image processor unavailable'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {failReason === 'misconfigured'
                ? 'This service is temporarily unavailable. Please try again later or contact support.'
                : 'Please try again in a few minutes.'}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Local keyframes for the indeterminate progress bar (no global CSS needed). */}
      <style>{`@keyframes worker-wake { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
}
