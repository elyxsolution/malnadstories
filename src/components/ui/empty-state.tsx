import Link from 'next/link';
import { type LucideIcon } from 'lucide-react';

/**
 * Standard empty state (Phase 10E.2). The ONE empty-state treatment across the product:
 * a dashed-border card, optional icon, a title (what/why), a description, and an optional
 * next-action link. Replaces the ad-hoc inline "No data" blocks so every list page reads
 * the same. Server-component-safe (no client directive); the action is a plain Link.
 *
 * Standard copy rule: title says what's missing, description says why + what to do next.
 * Never a bare "No data".
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center ${className}`}
    >
      {Icon && (
        <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground/70">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="font-display text-base font-medium tracking-tight text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
