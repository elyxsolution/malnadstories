// Observability shared vocabulary + thresholds (Phase 10B). Pure constants/helpers, safe in
// Server + Client Components (no I/O). Lowercase enums match the DB (0036) + system_alerts (0035).

export const SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'api',
  'payment',
  'upload',
  'pdf',
  'email',
  'auth',
  'support',
  'shipping',
  'system',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: 'INFO',
  warning: 'WARNING',
  error: 'ERROR',
  critical: 'CRITICAL',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  api: 'API',
  payment: 'Payment',
  upload: 'Upload',
  pdf: 'PDF',
  email: 'Email',
  auth: 'Auth',
  support: 'Support',
  shipping: 'Shipping',
  system: 'System',
};

// Chips mirror the monitoring palette (severityChip in monitoring/model.ts) for visual cohesion.
export const SEVERITY_CHIP: Record<Severity, string> = {
  info: 'bg-muted text-muted-foreground',
  warning: 'bg-amber-500/10 text-amber-600',
  error: 'bg-destructive/10 text-destructive',
  critical: 'bg-destructive/15 text-destructive font-semibold',
};

export const isSeverity = (v: string): v is Severity => (SEVERITIES as readonly string[]).includes(v);
export const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v);
export const severityLabel = (v: string): string => SEVERITY_LABEL[v as Severity] ?? v.toUpperCase();
export const categoryLabel = (v: string): string => CATEGORY_LABEL[v as Category] ?? v;
export const severityChip = (v: string): string => SEVERITY_CHIP[v as Severity] ?? 'bg-muted text-muted-foreground';

/**
 * Performance thresholds — ONE place to tune "slow" (mirrors monitoring's THRESHOLDS). A timing
 * is only recorded when it meets/exceeds its threshold, so the fast path does no work.
 */
export const PERF_THRESHOLDS = {
  slowApiMs: 1500, // API route / page request total
  slowActionMs: 2000, // server action
  slowPdfMs: 45_000, // album PDF render (Chromium)
  slowUploadMs: 30_000, // image hardening
  slowQueryMs: 800, // a single DB read/list (Phase 10D)
} as const;

/**
 * Stable dedupe fingerprint for a captured condition. Normalizes the message so dynamic ids
 * (uuids, long hex, numbers) collapse — a hot loop becomes ONE row, not N. Kept dependency-free
 * (no crypto import) so it is safe in any runtime; it is a short, stable, non-secret hash.
 */
export function fingerprint(category: string, source: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/[0-9a-f]{16,}/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `${category}|${source}|${djb2(normalized)}`;
}

// Tiny deterministic string hash (djb2) → base36. Not cryptographic; just a stable bucket key.
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
