import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS entirely.
 *
 * Use ONLY in server-side code (Server Actions, Route Handlers) for operations
 * where the authenticated role is intentionally withheld:
 *   - Order creation: total_amount must be computed server-side
 *   - Razorpay webhook: payment rows written after signature verification
 *   - Admin portal operations
 *
 * NEVER import this in a Client Component or any code that runs in the browser.
 * The SUPABASE_SERVICE_ROLE_KEY must stay in .env.local and never be exposed.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
