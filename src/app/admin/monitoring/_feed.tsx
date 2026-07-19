'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { RefreshCw, Check } from 'lucide-react';
import { runHealthChecks, resolveAlert } from '@/lib/actions/admin/monitoring';
import { severityChip } from '@/lib/monitoring/model';
import type { AlertRow } from '@/lib/monitoring/engine';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Live alerts feed (newest first) + optional management controls. View is available to any
 * monitoring:view role; "Run checks now" + Resolve are shown only to monitoring:manage. All
 * mutations go through the gated server actions.
 */
export default function AlertsFeed({ alerts, canManage }: { alerts: AlertRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
    else setMsg(res.error ?? 'Something went wrong.');
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Live alerts</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => run('refresh', () => runHealthChecks())}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'refresh' ? <InlineLoader /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run checks now
          </button>
        )}
      </div>

      {msg && <p className="px-4 pt-2 text-sm text-destructive">{msg}</p>}

      {alerts.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No alerts — all systems nominal.</p>
      ) : (
        <ul className="divide-y">
          {alerts.map((a) => (
            <li key={a.id} className={`flex items-start gap-3 px-4 py-3 ${a.resolved ? 'opacity-55' : ''}`}>
              <span className={`mt-0.5 flex-none rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${severityChip(a.severity)}`}>
                {a.severity}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.title}</p>
                {a.message && <p className="text-xs text-muted-foreground">{a.message}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {a.source} · {fmt(a.createdAt)}
                  {a.resolved ? ` · resolved ${a.resolvedAt ? fmt(a.resolvedAt) : ''}` : ''}
                </p>
              </div>
              {!a.resolved && canManage && (
                <button
                  type="button"
                  onClick={() => run(`resolve-${a.id}`, () => resolveAlert({ id: a.id }))}
                  disabled={busy !== null}
                  className="inline-flex flex-none items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {busy === `resolve-${a.id}` ? <InlineLoader /> : <Check className="h-3.5 w-3.5" />}
                  Resolve
                </button>
              )}
              {a.resolved && <span className="flex-none text-xs text-success">✓ resolved</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
