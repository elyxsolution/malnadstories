'use client';

import Link from 'next/link';
import Image from 'next/image';
import { LogOut } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import { signOut } from '@/lib/actions/auth';
import WizardProgress from '@/components/wizard-progress';
import { LAST_WIZARD_STEP } from '@/lib/wizard/steps';

/**
 * The ONE builder navbar — merges the global app header and the builder's identity/action
 * row into a single sticky bar. The global AppHeader is suppressed on the builder route
 * (see app-header-gate), so this is the only chrome above the editor.
 *
 *   Logo · Album Details — Upload & Build (progress) · Save & Exit · email · Logout
 *
 * The progress indicator is the SHARED `WizardProgress`, driven by `WIZARD_STEPS`. It used
 * to be a second, hand-maintained four-entry array declared right here — which had already
 * drifted from the wizard's own copy (its fourth step said "Review" where the wizard said
 * "Create"). There is now one declaration; this file states only WHERE the builder sits in
 * it, which is the final step: reaching the builder means the album already exists.
 */

export default function BuilderHeader({
  email,
  saving,
  exiting,
  onSaveExit,
}: {
  email: string;
  saving: boolean;
  exiting: boolean;
  onSaveExit: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-[72px] flex-none items-center gap-4 border-b border-border/70 bg-background/90 px-4 shadow-[0_1px_0_rgb(16_24_20/0.04),0_8px_24px_-20px_rgb(16_24_20/0.25)] backdrop-blur-md sm:px-6">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="group flex flex-none items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
      >
        <Image
          src="/logo.png"
          alt=""
          width={447}
          height={558}
          priority
          unoptimized
          className="h-8 w-auto transition-transform duration-200 ease-glide group-hover:scale-105"
        />
        <span className="hidden flex-col leading-none sm:flex">
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">Malnad Stories</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Album studio</span>
        </span>
      </Link>

      {/*
        Progress — absolutely centred so the brand/account widths never shift it.
        The builder IS the second step ("Upload & Build"): you cannot reach it without an
        album, so step one is always behind you. The album's draft/submitted status is
        surfaced by the builder's own submit/review UI, not by this bar.
      */}
      <WizardProgress
        current={LAST_WIZARD_STEP}
        tone="studio"
        className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 md:flex"
      />

      {/* Account + exit */}
      <div className="ml-auto flex flex-none items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onSaveExit}
          disabled={saving || exiting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-xs transition-all duration-150 ease-glide hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-60"
        >
          {exiting ? <InlineLoader /> : null}
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

