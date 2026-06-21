import { eq, max } from 'drizzle-orm';
import { db } from '@/db';
import { profiles, auditLog, adminRoles } from '@/db/schema';
import { requireCapability } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime } from '@/lib/admin/format';
import { type AdminRole } from '@/lib/auth/capabilities';
import RoleSelect from './_roles';

/**
 * Users & Roles (RBAC, Phase 9G). super_admin only (role:manage — enforced by the layout
 * route-guard AND the assignRole action). Lists admin accounts with their assigned back-office
 * role; an admin with NO admin_roles row shows as Super Admin (the migration-safe default).
 * Fixed-role assignment only — there is no custom-role editor.
 */
export default async function AdminUsersPage() {
  const me = await requireCapability('role:manage');

  const admins = await db
    .select({ id: profiles.id, name: profiles.name, createdAt: profiles.createdAt })
    .from(profiles)
    .where(eq(profiles.role, 'admin'));

  const [emails, activityRows, roleRows] = await Promise.all([
    adminUserEmails(admins.map((a) => a.id)),
    db.select({ actorId: auditLog.actorId, last: max(auditLog.createdAt) }).from(auditLog).groupBy(auditLog.actorId),
    db.select({ userId: adminRoles.userId, role: adminRoles.role }).from(adminRoles),
  ]);
  const lastBy = new Map(activityRows.map((r) => [r.actorId, r.last]));
  const roleBy = new Map(roleRows.map((r) => [r.userId, r.role as AdminRole]));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-xl font-bold">Users &amp; Roles</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {admins.length} admin account{admins.length === 1 ? '' : 's'}. Assign one of four fixed roles —
        <span className="font-medium"> Super Admin</span>, <span className="font-medium">Production</span>,
        <span className="font-medium"> Support</span>, <span className="font-medium">Content</span>. Admins without an
        assigned role default to Super Admin.
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2 text-right">Last active</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{a.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{emails.get(a.id) ?? '—'}</td>
                <td className="px-3 py-2">
                  <RoleSelect userId={a.id} currentRole={roleBy.get(a.id) ?? 'super_admin'} isSelf={a.id === me.userId} />
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {lastBy.get(a.id) ? fmtDateTime(lastBy.get(a.id) as unknown as string) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
