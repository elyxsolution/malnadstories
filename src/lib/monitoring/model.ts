// Monitoring shared vocabulary + the SINGLE thresholds map (alert rules in one place).
// Pure constants, safe in client + server. No I/O. Lowercase enums match the DB (0035).

export const HEALTH_STATUSES = ['healthy', 'warning', 'critical'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const SERVICES = [
  'database',
  'uploads',
  'photo_processing',
  'pdf_generation',
  'payments',
  'email',
  'support',
  'shipping',
] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_LABEL: Record<ServiceName, string> = {
  database: 'Database',
  uploads: 'Uploads',
  photo_processing: 'Photo processing',
  pdf_generation: 'PDF generation',
  payments: 'Payments',
  email: 'Email',
  support: 'Support',
  shipping: 'Shipping',
};

export const HEALTH_CHIP: Record<HealthStatus, string> = {
  healthy: 'bg-success/12 text-success',
  warning: 'bg-amber-500/10 text-amber-600',
  critical: 'bg-destructive/10 text-destructive',
};

export const SEVERITY_CHIP: Record<AlertSeverity, string> = {
  info: 'bg-muted text-muted-foreground',
  warning: 'bg-amber-500/10 text-amber-600',
  critical: 'bg-destructive/10 text-destructive',
};

export const serviceLabel = (v: string): string => SERVICE_LABEL[v as ServiceName] ?? v;
export const healthChip = (v: string): string => HEALTH_CHIP[v as HealthStatus] ?? 'bg-muted text-muted-foreground';
export const severityChip = (v: string): string => SEVERITY_CHIP[v as AlertSeverity] ?? 'bg-muted text-muted-foreground';

// Rank for aggregating an overall status (max across services).
export const HEALTH_RANK: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2 };
export function worstHealth(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (HEALTH_RANK[s] > HEALTH_RANK[acc] ? s : acc), 'healthy');
}

/**
 * THE alert-rule thresholds — one place to tune every collector (Phase 6). Counts are over
 * a recent window (minutes) to avoid alerting forever on old, already-handled failures.
 */
export const THRESHOLDS = {
  recentWindowMin: 60, // window for "recent failures" (email/payments)
  uploads: { stuckMin: 10, stuckWarn: 1, stuckCrit: 20 },
  photoProcessing: { backlogWarn: 50, backlogCrit: 200, rejectedWindowMin: 1440, rejectedWarn: 5 },
  pdf: { failedWarn: 1, failedCrit: 5, stuckMin: 5, stuckWarn: 1 },
  payments: { failedWarn: 1, failedCrit: 5, pendingStuckMin: 30, pendingStuckWarn: 1 },
  email: { failedWarn: 1, failedCrit: 10 },
  shipping: { failedWarn: 1, failedCrit: 5 },
  support: { backlogWarn: 25, backlogCrit: 75 },
} as const;

// What a collector emits when a rule is breached. dedupeKey makes alerts idempotent.
export type AlertSpec = {
  severity: AlertSeverity;
  source: ServiceName;
  title: string;
  message: string;
  dedupeKey: string;
};

export type ServiceHealth = {
  service: ServiceName;
  status: HealthStatus;
  message: string;
  alerts: AlertSpec[];
};
