import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { roleHasCapability } from '@/lib/auth/capabilities';

/**
 * WHO MAY WRITE THIS ALBUM — the single authorization boundary for album content.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────────────────────
 *
 * Every album write (`saveLayout`, `savePhotoEdit`, `saveCoverDesign`) proves ownership the same
 * way: it reads the album through the RLS-scoped authenticated client, and a row that is not the
 * caller's simply resolves to `null`. That is exactly right for a customer and it is the reason
 * those actions need no explicit `user_id` filter.
 *
 * It also means an administrator reviewing a submitted album cannot correct a typo in it. The
 * workflow was "send it back to the customer" for changes an admin could have made in seconds.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────────────
 *
 * OWNER FIRST, ALWAYS. The RLS read runs unchanged and unconditionally, so for a customer nothing
 * whatsoever about these actions changes — same client, same policy, same failure mode. Only when
 * RLS reports "not yours" is the second question asked, and it is asked of the EXISTING RBAC gate:
 * `album:manage`, the same capability that already authorises admin PDF generation and the admin
 * album console. A signed-in non-admin, or an admin whose back-office role lacks that capability,
 * gets `null` — which every caller turns into the ordinary "Album not found". No new role, no new
 * policy, no new secret, and no way to reach this from the browser: `requireCapability` resolves
 * the role server-side from `profiles.role` (locked by 0019) plus `admin_roles`, and audits denials.
 *
 * THE SERVICE-ROLE CLIENT IS RETURNED ONLY ON THE ADMIN BRANCH, and only after that check has
 * passed. It bypasses RLS by design — that is the whole point of an admin acting across customers —
 * so callers must keep pinning their statements to `albumId` exactly as they already do. Nothing
 * here widens what a customer can reach: the owner branch never sees it.
 */
export type AlbumWriteAccess = {
  /** The client the rest of the action must use. RLS-scoped for an owner; service role for an admin. */
  client: SupabaseClient;
  /** Who is writing. Callers use it for audit and for messaging — never to decide authorization. */
  actor: 'owner' | 'admin';
  /** The acting user's id (the customer, or the administrator). */
  userId: string;
  /** The album's OWNER, resolved on the admin branch so an audit row can name whose album it is. */
  ownerId: string | null;
};

/**
 * Resolve write access to one album. `null` = not authorized (or the album does not exist), which
 * every caller reports as "Album not found" — a non-owner must not be able to tell the two apart.
 */
export async function resolveAlbumWriteAccess(albumId: string): Promise<AlbumWriteAccess | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // 1 — OWNER. Unchanged: RLS answers, and for a customer this is the only branch that ever runs.
  const { data: own } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (own) return { client: supabase, actor: 'owner', userId: user.id, ownerId: user.id };

  // 2 — ADMIN. The existing capability gate.
  //
  // IMPORTED LAZILY, on the branch that needs it. `require-admin` reaches the Drizzle superuser
  // and React's server `cache()`, neither of which exists outside the Next server runtime — a
  // static import would make this module, and therefore every album write action, unloadable
  // anywhere else. The same deferred-import shape `auditAccessDenied` already uses for the
  // service client. It changes nothing about the check: a customer never reaches this line, and
  // an admin resolves it before any privileged client exists.
  let role: { role: Parameters<typeof roleHasCapability>[0] };
  try {
    const { getAdminContext } = await import('@/lib/auth/require-admin');
    role = await getAdminContext();
  } catch {
    return null;
  }
  if (!roleHasCapability(role.role, 'album:manage')) return null;

  const svc = createServiceClient();
  const { data: albumRow } = await svc.from('albums').select('id, user_id').eq('id', albumId).maybeSingle();
  const row = albumRow as { id: string; user_id: string } | null;
  if (!row) return null;

  return { client: svc, actor: 'admin', userId: user.id, ownerId: row.user_id };
}

/**
 * Record an administrator's edit to a customer's album in the append-only audit log (0016).
 *
 * Best-effort and never throws, exactly like every other `log_audit` call in this codebase: an
 * audit failure must not turn a successful save into an error the admin has to retry. Owner edits
 * are NOT audited — they always were the customer's own writes, and logging every autosave of
 * every album would bury the entries that matter.
 */
export async function auditAdminAlbumEdit(
  access: AlbumWriteAccess,
  albumId: string,
  action: 'album.layout_edited' | 'album.photo_edited' | 'album.cover_edited',
): Promise<void> {
  if (access.actor !== 'admin') return;
  try {
    await createServiceClient().rpc('log_audit', {
      p_actor_id: access.userId,
      p_actor_type: 'admin',
      p_action: action,
      p_entity_type: 'album',
      p_entity_id: albumId,
      p_metadata: { owner_id: access.ownerId },
    });
  } catch (e) {
    console.error('[admin] album edit audit failed — continuing', String(e));
  }
}
