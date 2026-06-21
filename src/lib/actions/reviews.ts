'use server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { OpenRevisionSchema } from '@/lib/validations';

export type ReviewActionResult = { ok: true } | { ok: false; error: string };

/**
 * Mark the album's active revision as "in progress" — a best-effort signal fired when the
 * customer opens the builder from the Review Center to work on requested changes.
 *
 * Authenticated client establishes the caller; the SECURITY DEFINER RPC re-verifies that
 * the album belongs to this customer before bumping its 'open' revision → 'in_progress'.
 * Purely informational (advisory) — it never gates anything and never touches
 * orders / payments / PDF / fulfilment. Failures are swallowed so navigation is never blocked.
 */
export async function markRevisionInProgress(input: unknown): Promise<ReviewActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = OpenRevisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const svc = createServiceClient();
    await svc.rpc('mark_revision_in_progress', {
      p_album_id: parsed.data.albumId,
      p_customer_id: user.id,
    });
  } catch (e) {
    // Best-effort only — the customer can still edit + resubmit regardless.
    console.error('[review] markRevisionInProgress — continuing', String(e));
  }
  return { ok: true };
}
