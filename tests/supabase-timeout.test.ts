/**
 * BOUNDED SUPABASE I/O — the 2026-08-28 `MIDDLEWARE_INVOCATION_TIMEOUT` incident.
 *
 * Supabase Auth stopped responding (connections accepted, no response ever sent) while
 * PostgREST on the same project stayed healthy. `@supabase/auth-js` issues every request with
 * no `AbortSignal` and no timeout, so `auth.getUser()` never settled, and Vercel killed the
 * middleware invocation at 25s. Signed-out traffic was unaffected because auth-js short-circuits
 * before any network call when there is no session cookie — hence 200 on /login and /pricing
 * while /dashboard, /cart, /orders and /account all returned 504.
 *
 * What is durably testable here is the BOUND, not the outage:
 *
 *   · a request that never answers is torn down instead of hanging forever;
 *   · the auth check gives up within its deadline and reports "no user", so every existing
 *     guard fails CLOSED (redirect to /login) rather than timing out;
 *   · a healthy call is untouched — no added latency, no swallowed result;
 *   · a real error still propagates, so genuine failures are not converted into "signed out".
 *
 * The provider outage itself cannot be asserted from a test; see tests/README.md.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  boundedFetch,
  getUserWithDeadline,
  AUTH_CHECK_DEADLINE_MS,
  SUPABASE_FETCH_TIMEOUT_MS,
  SUPABASE_CLIENT_BUDGET_MS,
} from '@/lib/supabase/timeout';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

/** A client whose getUser() never settles — exactly what production did. */
const hangingClient = { auth: { getUser: () => new Promise<never>(() => {}) } };

describe('boundedFetch', () => {
  it('aborts a request that never responds, instead of hanging forever', async () => {
    globalThis.fetch = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const started = Date.now();
    await expect(boundedFetch(50)('https://example.test')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('passes a healthy response straight through, unmodified', async () => {
    const body = { ok: true };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

    const res = await boundedFetch(5_000)('https://example.test');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(body);
  });

  it('supplies an AbortSignal on every call — auth-js supplies none of its own', async () => {
    const spy = vi.fn(async () => new Response('{}'));
    globalThis.fetch = spy as unknown as typeof fetch;

    await boundedFetch(5_000)('https://example.test');
    const init = (spy.mock.calls as unknown as [unknown, { signal?: AbortSignal }][])[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shares ONE budget across every call from the same client, so the tail cannot multiply', async () => {
    // The per-request timeout bounds each call but not their sum. A page doing an auth check
    // plus several queries used to pay it once per call — measured at 26s on /orders.
    globalThis.fetch = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const bounded = boundedFetch(60, 60);
    const started = Date.now();

    await expect(bounded('https://example.test/1')).rejects.toThrow();
    // Budget is now spent: further calls fail immediately instead of paying the timeout again.
    await expect(bounded('https://example.test/2')).rejects.toThrow(/budget/i);
    await expect(bounded('https://example.test/3')).rejects.toThrow(/budget/i);

    expect(Date.now() - started).toBeLessThan(2_000);
    // Only the first call ever reached the network.
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("honours a caller's own signal as well as the timeout", async () => {
    globalThis.fetch = vi.fn(
      (_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const caller = new AbortController();
    const pending = boundedFetch(60_000)('https://example.test', { signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe('getUserWithDeadline', () => {
  it('reports timedOut with a null user when the auth call never settles', async () => {
    const started = Date.now();
    const result = await getUserWithDeadline(hangingClient, 40);

    expect(result.timedOut).toBe(true);
    expect(result.user).toBeNull();
    // The whole point: it returns, and well inside Vercel's 25s middleware limit.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('returns the user unchanged on a healthy call, and does not wait for the deadline', async () => {
    const user = { id: 'user-1', email: 'traveller@example.test' };
    const started = Date.now();

    const result = await getUserWithDeadline(
      { auth: { getUser: async () => ({ data: { user } }) } },
      60_000,
    );

    expect(result).toEqual({ user, timedOut: false });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns a null user WITHOUT timedOut when the caller is genuinely signed out', async () => {
    // Signed-out is not a timeout: auth-js resolves this in ~1ms with no network call, and the
    // distinction is what keeps public routes fast during an Auth outage.
    const result = await getUserWithDeadline(
      { auth: { getUser: async () => ({ data: { user: null } }) } },
      60_000,
    );

    expect(result).toEqual({ user: null, timedOut: false });
  });

  it('propagates a real error rather than disguising it as a signed-out user', async () => {
    const boom = new Error('supabase exploded');
    await expect(
      getUserWithDeadline({ auth: { getUser: () => Promise.reject(boom) } }, 60_000),
    ).rejects.toThrow('supabase exploded');
  });
});

describe('the configured bounds', () => {
  it('keeps the auth deadline well inside Vercel’s 25s middleware limit', () => {
    expect(AUTH_CHECK_DEADLINE_MS).toBeLessThan(25_000);
    // Also inside the default serverless function limit, for the (app) layout check.
    expect(AUTH_CHECK_DEADLINE_MS).toBeLessThanOrEqual(10_000);
  });

  it('leaves the per-request socket bound generous enough never to fire on a healthy call', () => {
    // Measured Supabase REST latency from this project during the incident was ~276ms p50,
    // so both bounds sit an order of magnitude above a healthy call.
    expect(SUPABASE_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(SUPABASE_CLIENT_BUDGET_MS).toBeGreaterThanOrEqual(SUPABASE_FETCH_TIMEOUT_MS);
    // Worst case for one page render is the middleware deadline plus one client budget; keep
    // that under the platform function limit, or the 504 simply moves from middleware to page.
    expect(AUTH_CHECK_DEADLINE_MS + SUPABASE_CLIENT_BUDGET_MS).toBeLessThan(15_000);
  });
});
