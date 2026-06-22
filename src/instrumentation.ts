/**
 * Next.js instrumentation (Phase 10B). Runs once at server startup. In the Node runtime it
 * installs last-resort handlers so an unhandled rejection / uncaught exception is CAPTURED to
 * error_events before it would otherwise vanish into stdout. Log-and-continue: we do NOT change
 * crash semantics (no process.exit here) — this only adds visibility.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic import: keep the capture layer (server-only) out of the edge bundle.
  const { captureException } = await import('@/lib/observability/capture');

  process.on('unhandledRejection', (reason) => {
    void captureException(reason, {
      source: 'process',
      category: 'system',
      severity: 'critical',
      metadata: { kind: 'unhandledRejection' },
    });
  });

  process.on('uncaughtException', (err) => {
    void captureException(err, {
      source: 'process',
      category: 'system',
      severity: 'critical',
      metadata: { kind: 'uncaughtException' },
    });
  });
}
