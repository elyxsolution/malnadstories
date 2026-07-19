'use client';

import { Puzzle, Crown, Star, Pin, BookImage } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { STUDIO_PRIMARY } from './_ui';
import { statusChip, statusLabel } from '@/lib/templates/model';

/** Blueprint identity for the builder's dedicated Blueprint-Mode chrome (0046). */
export type BlueprintMeta = {
  name: string;
  isDefault: boolean;
  featured: boolean;
  pinned: boolean;
  status: string;
  updatedAt: string;
};

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

/**
 * BLUEPRINT MODE header — replaces the customer builder navbar entirely while editing a reusable
 * blueprint. It carries no customer chrome (no progress steps, no account/logout, no ordering): its
 * only job is to make it unmistakable that "I am editing a reusable Blueprint," and to surface the
 * blueprint's identity + live capacity + save state at all times.
 */
export function BlueprintHeader({
  meta,
  size,
  capacity,
  recommended,
  lastSaved,
  dirty,
}: {
  meta: BlueprintMeta | null;
  size: number;
  capacity: number;
  recommended: number;
  lastSaved: number | null;
  dirty: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-[72px] flex-none items-center gap-4 border-b border-studio/25 bg-studio-soft/50 px-4 backdrop-blur-md sm:px-6">
      {/* Identity — puzzle mark + "Blueprint Mode" label + name + merchandising badges */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-studio text-studio-foreground shadow-soft">
          <Puzzle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-studio">Blueprint Mode</span>
            {meta && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusChip(meta.status)}`}>
                {statusLabel(meta.status)}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-display text-[16px] font-semibold tracking-tight text-foreground" title={meta?.name}>
              {meta?.name ?? 'Untitled blueprint'}
            </h1>
            <div className="flex flex-none items-center gap-1">
              {meta?.isDefault && <MiniBadge className="bg-gold/15 text-gold ring-gold/25"><Crown className="h-3 w-3" /> Default</MiniBadge>}
              {meta?.featured && <MiniBadge className="bg-primary/10 text-primary ring-primary/20"><Star className="h-3 w-3" /> Featured</MiniBadge>}
              {meta?.pinned && <MiniBadge className="bg-studio/10 text-studio ring-studio/20"><Pin className="h-3 w-3" /> Pinned</MiniBadge>}
            </div>
          </div>
        </div>
      </div>

      {/* Meta + save state */}
      <div className="ml-auto flex flex-none items-center gap-2.5">
        <div className="hidden items-center gap-2 lg:flex">
          <MetaPill k="Size" v={`${size} pages`} />
          <MetaPill k="Capacity" v={`${capacity}`} />
          <MetaPill k="Recommended" v={`${recommended}`} />
        </div>
        <span className="mx-1 hidden h-8 w-px bg-border lg:block" />
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            dirty ? 'bg-warning/10 text-warning ring-1 ring-warning/20' : 'bg-secondary text-muted-foreground ring-1 ring-border/60'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dirty ? 'animate-pulse bg-warning' : 'bg-studio'}`} />
          {dirty ? 'Unsaved changes' : lastSaved ? `Blueprint saved · ${fmtTime(lastSaved)}` : 'Blueprint saved'}
        </span>
      </div>
    </header>
  );
}

function MetaPill({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border bg-card px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="text-[13px] font-semibold tabular-nums text-foreground">{v}</span>
    </span>
  );
}

function MiniBadge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${className}`}>
      {children}
    </span>
  );
}

/**
 * Exit-Blueprint confirmation — shown only when there are unsaved changes. Save-and-exit, discard,
 * or cancel. All copy is blueprint-specific (never "album"). Reuses the studio dialog language.
 */
export function ExitBlueprintDialog({
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="animate-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-[2px]" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-bp-title"
        className="animate-rise w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-warning/10 text-warning ring-1 ring-warning/20">
              <BookImage className="h-5 w-5" />
            </span>
            <h2 id="exit-bp-title" className="text-[15px] font-semibold tracking-tight">Unsaved blueprint changes</h2>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
            You have unsaved changes to this blueprint. Save them before leaving, or discard to keep the last saved version.
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
            Discard changes
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={onSave} disabled={saving} className={STUDIO_PRIMARY}>
              {saving ? <InlineLoader /> : <BookImage />} Save blueprint
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
