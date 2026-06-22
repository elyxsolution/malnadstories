/**
 * Standard status badge (Phase 10E.2). The ONE badge structure for every status pill —
 * orders, shipments, reviews, support, refunds, reprints, monitoring, errors. It consumes
 * the existing per-domain chip CLASS string (e.g. `reviewStatusChip(status)`,
 * `shipmentStatusChip(status)`) verbatim, so colors are unchanged; it only unifies the
 * wrapper (radius, padding, text size, weight, optional leading dot) that was previously
 * re-inlined at every call site. Server-component-safe.
 *
 * Usage: <StatusBadge className={statusChip(value)} label={statusLabel(value)} />
 */
export default function StatusBadge({
  label,
  className = 'bg-muted text-muted-foreground',
  dot = false,
}: {
  label: string;
  /** The domain chip class string (bg/text); defaults to a neutral muted badge. */
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {label}
    </span>
  );
}
