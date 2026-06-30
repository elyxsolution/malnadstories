import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sprig } from '@/components/brand';

/**
 * Shared frame for the auth surfaces (login / signup / reset) — a premium two-column layout.
 *
 * LEFT  (md+): a large immersive travel image under a dark forest-green overlay, with the
 *   Oscar Wilde quote + studio branding at the bottom. The image is a same-origin asset
 *   (`/auth/forest.jpg`) layered over a forest-green gradient FALLBACK, so it looks finished
 *   even before the photo is dropped in. On mobile it becomes a short top band.
 * RIGHT: a minimal, vertically-centred form column (the Sprig mark, heading, subheading,
 *   and the page's own form) on the warm off-white surface, with lots of whitespace.
 *
 * Pure presentation; each page owns its form + actions. Motion is CSS-only and motion-safe.
 */
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="animate-fade-in flex min-h-screen flex-col md:flex-row">
      {/* LEFT — immersive image panel */}
      <aside className="relative isolate flex min-h-[32vh] flex-col justify-end overflow-hidden bg-[hsl(156_36%_12%)] md:min-h-screen md:w-[45%] lg:w-[42%]">
        {/* Image layer (gradient fallback shows through if the asset is absent). */}
        <div
          aria-hidden
          className="ms-kenburns absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/auth/forest.jpg')" }}
        />
        {/* Dark forest-green overlay for text legibility. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(165deg,hsl(156_42%_9%/0.28),hsl(156_46%_6%/0.84))]"
        />

        <div className="animate-rise relative z-10 p-8 sm:p-10 lg:p-14">
          <blockquote className="max-w-md">
            <p className="font-display text-2xl italic leading-snug text-white/95 sm:text-[1.7rem]">
              “Memory is the diary we all carry about with us.”
            </p>
            <footer className="mt-5 sm:mt-7">
              <span className="block h-px w-14 bg-[hsl(var(--gold-pale)/0.55)]" />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--gold-pale))]">
                Oscar Wilde
              </p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-white/55">
                Malnad Stories Preservation Studio
              </p>
            </footer>
          </blockquote>
        </div>
      </aside>

      {/* RIGHT — form column */}
      <main className="flex flex-1 items-center justify-center bg-background px-6 py-12 sm:px-10">
        <div className="animate-rise w-full max-w-sm">
          <Link
            href="/"
            aria-label="Malnad Stories home"
            className="mb-8 flex w-fit items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/[0.07] text-primary ring-1 ring-primary/15">
              <Sprig className="h-5 w-5" />
            </span>
          </Link>

          {eyebrow && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">{eyebrow}</p>
          )}
          <h1 className="text-pretty font-display text-[1.95rem] font-semibold leading-[1.05] tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}

          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
