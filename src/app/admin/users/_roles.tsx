'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { assignRole } from '@/lib/actions/admin/roles';
import { ADMIN_ROLES, roleLabel, type AdminRole } from '@/lib/auth/capabilities';

/**
 * Per-admin role selector (super_admin only). Changing the value calls the
 * requireCapability('role:manage')-gated assignRole action (which also forbids self-edits +
 * non-admin targets and audits the change). This is fixed-role ASSIGNMENT, not a role editor.
 */
export default function RoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: AdminRole;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<AdminRole>(currentRole);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const change = async (next: AdminRole) => {
    const prev = role;
    setRole(next);
    setBusy(true);
    setMsg(null);
    const res = await assignRole({ userId, role: next });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setRole(prev); // revert on failure
      setMsg(res.error ?? 'Could not update the role.');
    }
  };

  if (isSelf) {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{roleLabel(role)}</span>
        <span className="text-xs text-muted-foreground">(you)</span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={role}
        disabled={busy}
        onChange={(e) => change(e.target.value as AdminRole)}
        className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:border-ring disabled:opacity-50"
      >
        {ADMIN_ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {msg && <span className="text-xs text-destructive">{msg}</span>}
    </div>
  );
}
