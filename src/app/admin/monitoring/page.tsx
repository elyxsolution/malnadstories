import { requireCapability } from '@/lib/auth/require-admin';
import { roleHasCapability } from '@/lib/auth/capabilities';
import { collectHealth } from '@/lib/monitoring/collectors';
import { persistIfStale, listRecentAlerts } from '@/lib/monitoring/engine';
import { serviceLabel, healthChip, worstHealth, type HealthStatus } from '@/lib/monitoring/model';
import AlertsFeed from './_feed';

export const dynamic = 'force-dynamic';

/**
 * System monitoring (Phase 10A). Gated monitoring:view (super_admin / production / support).
 * Collectors run live (cheap aggregates); a snapshot is persisted only if the last run is
 * stale (throttled — opening this page can't cause a write storm). The alerts feed reads the
 * persisted, deduplicated alerts.
 */
export default async function MonitoringPage() {
  const ctx = await requireCapability('monitoring:view');
  const canManage = roleHasCapability(ctx.role, 'monitoring:manage');

  const health = await collectHealth();
  await persistIfStale(health); // best-effort, throttled
  const alerts = await listRecentAlerts(50);

  const overall = worstHealth(health.map((h) => h.status as HealthStatus));
  const warnings = health.filter((h) => h.status === 'warning').length;
  const criticals = health.filter((h) => h.status === 'critical').length;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">System monitoring</h1>
          <p className="text-sm text-muted-foreground">Live service health + active alerts. Read-only over existing data.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${healthChip(overall)}`}>
            Overall: {overall}
          </span>
          <span className="text-muted-foreground">{warnings} warning · {criticals} critical</span>
        </div>
      </div>

      {/* System Health Panel */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {health.map((h) => (
          <div key={h.service} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{serviceLabel(h.service)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${healthChip(h.status)}`}>
                {h.status}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{h.message}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Checked just now · snapshots persist at most once every 5 minutes.</p>

      {/* Live Alerts Feed */}
      <div className="mt-6">
        <AlertsFeed alerts={alerts} canManage={canManage} />
      </div>
    </div>
  );
}
