/**
 * SIGN-IN ERROR CLASSIFICATION — the 2026-08-28 Supabase Auth outage.
 *
 * `signIn` collapsed EVERY `signInWithPassword` error into "Invalid email or password". Two of
 * those collapses are deliberate and must stay: an unknown email and a wrong password have to
 * be indistinguishable, or the form becomes an account-enumeration oracle.
 *
 * The third was a bug. When Supabase Auth stopped responding — `POST /auth/v1/token` returned
 * nothing at 5s, 12s or 90s while PostgREST answered in ~600ms — auth-js raised an
 * `AuthRetryableFetchError`, and every customer with a CORRECT password was told their password
 * was wrong. They retyped it, hit the rate limiter, and requested resets against a service that
 * was down, while nothing was recorded anywhere.
 *
 * What is durably testable is the classification, not the outage:
 *   · a transport failure is reported as a transport failure, and captured;
 *   · a rejected credential still says "Invalid email or password";
 *   · bad email and bad password still return the SAME string as each other;
 *   · a successful sign-in still redirects to /dashboard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const state = {
  signInResult: { error: null } as { error: unknown },
  captured: [] as { severity?: string; source: string }[],
  redirectedTo: null as string | null,
  cookieOps: [] as string[],
};

const cookieStore = {
  set: (name: string) => { state.cookieOps.push(`set:${name}`); },
  delete: (name: string) => { state.cookieOps.push(`delete:${name}`); },
  get: () => undefined,
  getAll: () => [],
};

vi.mock('next/headers', () => ({ cookies: () => cookieStore, headers: () => new Map() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    state.redirectedTo = to;
    // Next's redirect() throws to unwind; mirror that so control flow matches production.
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => state.signInResult } }),
}));
vi.mock('@/lib/security/guard', () => ({
  clientIp: () => '203.0.113.7',
  checkLimit: async () => ({ ok: true }),
}));
vi.mock('@/lib/observability/capture', () => ({
  captureException: async (_e: unknown, ctx: { severity?: string; source: string }) => {
    state.captured.push(ctx);
    return null;
  },
}));

import { signIn } from '@/lib/actions/auth';

const form = (email = 'traveller@example.com', password = 'correct-horse-battery') => {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  fd.set('remember', 'on');
  return fd;
};

beforeEach(() => {
  state.signInResult = { error: null };
  state.captured = [];
  state.redirectedTo = null;
  state.cookieOps = [];
});

describe('signIn error classification', () => {
  it('reports an unreachable auth service as a SERVICE failure, not a credentials failure', async () => {
    // Exactly what our deadline abort produces: auth-js wraps any thrown fetch as retryable.
    state.signInResult = { error: new AuthRetryableFetchError('Supabase request exceeded 5000ms', 0) };

    const res = await signIn(null, form());

    expect(res?.error).toBeTruthy();
    expect(res?.error).not.toMatch(/invalid email or password/i);
    expect(res?.error).toMatch(/couldn’t reach|could not reach/i);
    expect(state.redirectedTo).toBeNull();
  });

  it('records the outage instead of letting it look like mistyped passwords', async () => {
    state.signInResult = { error: new AuthRetryableFetchError('Supabase request exceeded 5000ms', 0) };
    await signIn(null, form());

    expect(state.captured).toHaveLength(1);
    expect(state.captured[0].source).toBe('auth');
    expect(state.captured[0].severity).toBe('critical');
  });

  it('treats an upstream 503 as a service failure too (auth-js marks it retryable)', async () => {
    state.signInResult = { error: new AuthRetryableFetchError('service unavailable', 503) };
    const res = await signIn(null, form());
    expect(res?.error).not.toMatch(/invalid email or password/i);
  });

  it('still says "Invalid email or password" for a genuinely rejected credential', async () => {
    state.signInResult = { error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') };

    const res = await signIn(null, form());

    expect(res).toEqual({ error: 'Invalid email or password' });
    expect(state.captured).toHaveLength(0); // a wrong password is not an incident
  });

  it('keeps unknown-email and wrong-password INDISTINGUISHABLE — no enumeration oracle', async () => {
    state.signInResult = { error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') };
    const wrongPassword = await signIn(null, form('real@example.com', 'nope'));

    state.signInResult = { error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') };
    const unknownEmail = await signIn(null, form('nobody@example.com', 'nope'));

    expect(wrongPassword).toEqual(unknownEmail);
  });

  it('still signs in and redirects to /dashboard on success', async () => {
    state.signInResult = { error: null };
    await expect(signIn(null, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(state.redirectedTo).toBe('/dashboard');
  });

  it('still writes the remember_me cookie before contacting Supabase', async () => {
    state.signInResult = { error: new AuthRetryableFetchError('down', 0) };
    await signIn(null, form());
    expect(state.cookieOps).toContain('set:remember_me');
  });
});
