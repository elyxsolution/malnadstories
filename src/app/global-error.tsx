'use client';

import { useEffect } from 'react';

/**
 * Global error boundary (Phase 10B). Catches React render crashes that escape segment-level
 * error boundaries. It reports a sanitized summary to the observability sink (best-effort, fire-
 * and-forget) and shows a calm recovery screen. global-error replaces the root layout, so it must
 * render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Send only message/stack/digest/path — never component props or page data.
    void fetch('/api/observability/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <div className="rounded-xl border bg-card p-8 shadow-sm">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              An unexpected error occurred. Our team has been notified. You can try again, and if
              it keeps happening, please come back shortly.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">Ref: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={() => reset()}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.97]"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
