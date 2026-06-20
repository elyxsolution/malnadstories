import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sprig } from '@/components/brand';

/**
 * Shared frame for the auth surfaces (login / signup / reset). Editorial brand
 * treatment — the Sprig mark, an uppercase eyebrow, a Fraunces display title — over
 * the warm brand surface, so every entry point feels like the same product. Pure
 * presentation; each page owns its own form + actions.
 */
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="brand-surface flex min-h-screen flex-col items-center justify-center p-4">
      <div className="animate-rise w-full max-w-md">
        <Link
          href="/"
          className="mx-auto mb-7 flex w-fit items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
            <Sprig className="h-[18px] w-[18px]" />
          </span>
          Malnad Stories
        </Link>

        <div className="overflow-hidden rounded-2xl border bg-card p-7 shadow-panel sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">{eyebrow}</p>
          <h1 className="mt-2 text-pretty font-display text-[1.9rem] font-semibold leading-[1.05] tracking-tight">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
