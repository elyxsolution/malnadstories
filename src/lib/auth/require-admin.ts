import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { eq } from 'drizzle-orm';

/** Thrown when the caller is not an authenticated admin. */
export class NotAdminError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'NotAdminError';
  }
}

/**
 * Server-only admin gate and the backend source of truth for admin authorization.
 *
 * Validates the JWT with getUser() (not getSession()), then checks the role via
 * Drizzle (postgres superuser — RLS-independent, ungameable). Call this at the top of
 * EVERY admin server action and admin page loader; the admin layout is only a belt.
 * Throws NotAdminError if the caller is not a signed-in admin.
 *
 * Wrapped in React `cache()`: within a SINGLE server render, the admin layout and the
 * page it wraps (and any child that calls this) share ONE getUser() + ONE profile
 * lookup instead of repeating both. cache() is scoped per request render, so this is
 * not a cross-request cache — every request still re-validates. Authorization is
 * unchanged; only the redundant work inside one render is deduplicated. A rejection
 * (NotAdminError) is memoized too, so all callers in the render see the same denial.
 */
export const requireAdmin = cache(
  async (): Promise<{ userId: string; email: string | null }> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotAdminError('Not signed in');

    const [profile] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, user.id))
      .limit(1);

    if (!profile || profile.role !== 'admin') throw new NotAdminError('Forbidden');
    return { userId: user.id, email: user.email ?? null };
  },
);
