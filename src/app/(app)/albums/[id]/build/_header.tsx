'use client';

import Link from 'next/link';
import { Check, Loader2, LogOut } from 'lucide-react';
import { signOut } from '@/lib/actions/auth';
import { Sprig } from '@/components/brand';

/**
 * The ONE builder navbar (Part 1) — merges the old global app header and the builder's
 * identity/action row into a single sticky bar. The global AppHeader is suppressed on the
 * builder route (see app-header-gate), so this is the only chrome above the editor.
 *
 *   Logo · Begin — Format — Memories — Review (progress) · Save & Exit · email · Logout
 *
 * The four steps mirror the album-creation wizard (`albums/new/_wizard.tsx`). In the
 * builder you are at Memories (draft) → Review (submitted); earlier steps are complete.
 */

const STEPS = ['Begin', 'Format', 'Memories', 'Review'] as const;

export default function BuilderHeader({
  email,
  status,
  saving,
  exiting,
  onSaveExit,
}: {
  email: string;
  status: string;
  saving: boolean;
  exiting: boolean;
  onSaveExit: () => void;
}) {
  // draft → working in Memories; submitted → Review. Earlier steps are always complete.
  const current = status === 'submitted' ? 3 : 2;

  return (
    <header className="sticky top-0 z-40 flex h-[72px] flex-none items-center gap-4 border-b border-border/70 bg-background/90 px-4 shadow-[0_1px_0_rgb(16_24_20/0.04),0_8px_24px_-20px_rgb(16_24_20/0.25)] backdrop-blur-md sm:px-6">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="group flex flex-none items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/[0.08] text-studio ring-1 ring-studio/15 transition-transform duration-200 ease-glide group-hover:scale-105">
          <Sprig className="h-[17px] w-[17px]" />
        </span>
        <span className="hidden flex-col leading-none sm:flex">
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">Malnad Stories</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Album studio</span>
        </span>
      </Link>

      {/* Progress — absolutely centred so the brand/account widths never shift it */}
      <ProgressSteps current={current} />

      {/* Account + exit */}
      <div className="ml-auto flex flex-none items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onSaveExit}
          disabled={saving || exiting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-xs transition-all duration-150 ease-glide hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-60"
        >
          {exiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save &amp; exit
        </button>
        <span className="hidden max-w-[180px] truncate text-[13px] text-muted-foreground lg:inline" title={email}>
          {email}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Log out"
            title="Log out"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </form>
      </div>
    </header>
  );
}

function ProgressSteps({ current }: { current: number }) {
  return (
    <ol className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center">
            <span className="flex items-center gap-2 px-1.5">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-200 ${
                  done
                    ? 'bg-studio text-studio-foreground'
                    : active
                      ? 'bg-studio/[0.12] text-studio ring-1 ring-studio/30'
                      : 'bg-secondary text-muted-foreground/70 ring-1 ring-border'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={`text-[13px] tracking-tight transition-colors duration-200 ${
                  active ? 'font-semibold text-foreground' : done ? 'text-foreground/70' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className={`h-px w-6 ${i < current ? 'bg-studio/40' : 'bg-border'}`} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
