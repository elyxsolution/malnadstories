/**
 * Bounded Supabase I/O.
 *
 * WHY THIS FILE EXISTS — the 2026-08-28 production incident.
 *
 * `@supabase/auth-js` issues every HTTP request with NO `AbortSignal` and NO timeout
 * (`dist/main/lib/fetch.js` → `_handleRequest` calls `fetcher(url, params)` bare). So when
 * Supabase Auth stops *responding* — as opposed to erroring — a call to `auth.getUser()`
 * never settles. On Vercel that becomes `MIDDLEWARE_INVOCATION_TIMEOUT` after 25s on every
 * request that carries an `sb-*` cookie, i.e. a total outage for signed-in users while
 * signed-out traffic is unaffected (auth-js short-circuits with `AuthSessionMissingError`
 * before any network call when there is no session cookie).
 *
 * Two independent bounds are needed, because one alone is not sufficient:
 *
 *  1. `boundedFetch` — a socket-level bound, so a wedged connection is torn down instead of
 *     held open. It THROWS on timeout, which auth-js classifies as `AuthRetryableFetchError`.
 *     That classification matters: a *non*-retryable error makes `_callRefreshToken` call
 *     `_removeSession()`, which would sign every user out during a transient provider
 *     outage. Throwing keeps the session intact.
 *
 *  2. `getUserWithDeadline` — an overall bound on the auth check. Necessary because
 *     `_refreshAccessToken` retries retryable failures with exponential backoff bounded only
 *     by `AUTO_REFRESH_TICK_DURATION_MS` (30_000ms in auth-js 2.106.2) — longer than Vercel's
 *     25s middleware limit. A per-request timeout only changes how many attempts fit inside
 *     that budget; it cannot shorten it.
 *
 * This adds no retry, changes no authorization rule, and hides nothing: an exhausted
 * deadline is reported as "no user", which every existing guard already handles by failing
 * closed (redirect to /login).
 */

/** Socket-level bound for a SINGLE Supabase HTTP request. ~18x measured healthy latency. */
export const SUPABASE_FETCH_TIMEOUT_MS = 5_000;

/**
 * Total bound on Supabase I/O for ONE client instance — and since a client is created per
 * request (`server.ts` calls `createClient()` per render, middleware once per invocation),
 * that is effectively a per-request budget.
 *
 * Needed because the per-request timeout above bounds each call but not their SUM: a page that
 * makes an auth check plus several queries multiplies it. Measured on this app during the
 * incident, /orders took 26s that way — past the platform's function limit, i.e. still a 504,
 * just from the function instead of the middleware. With the budget, the first call to find it
 * exhausted fails immediately and the request unwinds.
 *
 * ~10-20x the healthy total (a page's whole Supabase workload measures well under 1s), so it
 * does not fire in normal operation.
 */
export const SUPABASE_CLIENT_BUDGET_MS = 8_000;

/**
 * Overall bound for an authentication check on a shared request path (middleware, the
 * authenticated layout). Well under Vercel's 25s middleware limit and ~20x normal latency.
 */
export const AUTH_CHECK_DEADLINE_MS = 5_000;

/**
 * `fetch` with a per-request timeout, for use as the Supabase client's `global.fetch`.
 * Any caller-supplied signal (e.g. postgrest's `.abortSignal()`) is honoured as well.
 */
export function boundedFetch(
  timeoutMs = SUPABASE_FETCH_TIMEOUT_MS,
  budgetMs = SUPABASE_CLIENT_BUDGET_MS,
): typeof fetch {
  const budgetExpiresAt = Date.now() + budgetMs;

  return async (input, init) => {
    const remaining = budgetExpiresAt - Date.now();
    if (remaining <= 0) {
      // THROW, never return a synthetic Response. auth-js classifies a thrown fetch error as
      // `AuthRetryableFetchError`; a *non*-retryable one makes `_callRefreshToken` call
      // `_removeSession()`, which would sign every user out during a provider blip.
      throw new Error(`Supabase request budget of ${budgetMs}ms exhausted for this request`);
    }

    const controller = new AbortController();
    const callerSignal = init?.signal;

    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const perRequestMs = Math.min(timeoutMs, remaining);
    const timer = setTimeout(
      () => controller.abort(new Error(`Supabase request exceeded ${perRequestMs}ms`)),
      perRequestMs,
    );

    try {
      // Cleared once response headers arrive — the body stream is deliberately not bounded,
      // so a large but healthy response is never truncated.
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

const DEADLINE_REACHED = Symbol('supabase-auth-deadline');

/**
 * `supabase.auth.getUser()` with an overall deadline.
 *
 * Resolves `{ user: null, timedOut: true }` if the deadline is reached. Callers must treat
 * that exactly as they already treat a signed-out user — fail closed. Errors other than the
 * deadline are NOT caught here, so existing failure behaviour is unchanged.
 */
export async function getUserWithDeadline<TUser>(
  supabase: { auth: { getUser: () => Promise<{ data: { user: TUser | null } }> } },
  deadlineMs = AUTH_CHECK_DEADLINE_MS,
): Promise<{ user: TUser | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE_REACHED>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_REACHED), deadlineMs);
  });

  try {
    const result = await Promise.race([supabase.auth.getUser(), deadline]);
    if (result === DEADLINE_REACHED) return { user: null, timedOut: true };
    return { user: result.data.user, timedOut: false };
  } finally {
    clearTimeout(timer);
  }
}
