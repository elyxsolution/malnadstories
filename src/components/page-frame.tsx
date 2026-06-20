import type { ReactNode } from 'react';

/**
 * Shared editorial page frame (Claude Design). A consistent content column — gold
 * eyebrow, Cormorant display masthead, optional subtitle — used across the customer
 * surfaces so every screen shares the same rhythm and margins. Presentation only.
 */
export default function PageFrame({
  eyebrow,
  title,
  subtitle,
  actions,
  max = 'max-w-4xl',
  children,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  max?: string;
  children: ReactNode;
}) {
  return (
    <div className={`animate-rise mx-auto w-full ${max} px-5 py-9 sm:px-8 lg:py-12`}>
      {(eyebrow || title || actions) && (
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{eyebrow}</p>
            )}
            {title && (
              <h1 className="mt-3 font-display text-[2.6rem] font-normal leading-[0.98] tracking-tight text-primary">
                {title}
              </h1>
            )}
            {subtitle && <p className="mt-2 text-[15px] font-light text-muted-foreground">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </div>
  );
}
