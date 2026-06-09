// Small presentational helpers for the admin console (server + client safe).

export const inr = (n: number | string | null | undefined): string => {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  return `₹${(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export const shortId = (id: string): string => id.slice(0, 8);

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

// Status → tailwind chip classes (internal tool; muted palette).
export const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  paid: 'bg-primary/10 text-primary',
  processing: 'bg-blue-500/10 text-blue-600',
  printing: 'bg-indigo-500/10 text-indigo-600',
  packed: 'bg-amber-500/10 text-amber-600',
  shipped: 'bg-violet-500/10 text-violet-600',
  delivered: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-muted text-muted-foreground line-through',
  failed: 'bg-destructive/10 text-destructive',
};

export function statusChip(status: string): string {
  return STATUS_CHIP[status] ?? 'bg-muted text-muted-foreground';
}
