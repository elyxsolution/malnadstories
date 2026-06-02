import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Service-role Supabase client — bypasses RLS. The worker is trusted backend
 * processing every user's jobs, so it intentionally has no per-user JWT. The
 * service key lives only in server/worker env, never in the browser.
 */
export const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
