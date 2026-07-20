'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MessageSquareWarning,
  ChevronDown,
  Check,
  ArrowRight,
  Image as ImageIcon,
  BookOpen,
  MapPin,
  CircleDot,
} from 'lucide-react';
import PrintDiagnostics from '@/components/print-diagnostics';
import { type AlbumValidationReport, type IssueAction } from '@/lib/albums/validation';
import { type RenderReadinessReport } from '@/lib/albums/render-readiness';

/**
 * Review Summary card (CHANGE 4/5/6/10) — the dedicated Review Revision banner shown ABOVE the
 * (unchanged) builder canvas when an album was reopened because the review team requested changes.
 *
 * It is pure UX on top of existing data: it parses the review team's free-text `requestedChanges`
 * into a checklist, lets the customer tick items off (progress is client-only, in localStorage —
 * it never touches the review workflow), and turns page/cover/photo mentions into one-click jumps
 * that reuse the builder's existing navigation. No validation/review/business logic here.
 */

type JumpTarget = { kind: 'page'; page: number } | { kind: 'cover' } | { kind: 'incomplete' } | null;

/** Detect a navigation cue in one requested-change line (CHANGE 5). */
function detectTarget(text: string): JumpTarget {
  const t = text.toLowerCase();
  const page = t.match(/\bpage\s+(\d+)/);
  if (page) return { kind: 'page', page: Number(page[1]) };
  if (/\b(cover|title)\b/.test(t)) return { kind: 'cover' };
  if (/\b(missing|empty|blank|incomplete|complete the|add (more )?photo)/.test(t)) return { kind: 'incomplete' };
  return null;
}

function parseItems(raw: string | null): { text: string; target: JumpTarget }[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()) // strip bullets / numbering
    .filter(Boolean)
    .map((text) => ({ text, target: detectTarget(text) }));
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TIMELINE = ['Album submitted', 'Payment received', 'Review completed', 'Changes requested', 'Currently editing'] as const;

export default function ReviewRevisionCard({
  albumId,
  requestedChanges,
  requestedAt,
  revisionNumber,
  onGoToPage,
  onGoToCover,
  onGoToIncomplete,
  validation = null,
  renderReadiness = null,
  onIssueNav,
}: {
  albumId: string;
  requestedChanges: string | null;
  requestedAt: string | null;
  revisionNumber: number;
  onGoToPage: (physicalPage: number) => void;
  onGoToCover: () => void;
  onGoToIncomplete: () => void;
  /** Centralized reports — the review card CONSUMES them via the shared PrintDiagnostics (no new logic). */
  validation?: AlbumValidationReport | null;
  renderReadiness?: RenderReadinessReport | null;
  onIssueNav?: (action: IssueAction) => void;
}) {
  const items = useMemo(() => parseItems(requestedChanges), [requestedChanges]);
  const storageKey = `ms-review-progress:${albumId}:${revisionNumber}`;

  const [open, setOpen] = useState(true);
  const [done, setDone] = useState<boolean[]>(() => items.map(() => false));

  // Restore per-revision checklist progress (client-only; never persisted to the review record).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as boolean[];
        if (Array.isArray(saved) && saved.length === items.length) setDone(saved);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, items.length]);

  const toggle = (i: number) => {
    setDone((prev) => {
      const next = prev.map((v, idx) => (idx === i ? !v : v));
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const completed = done.filter(Boolean).length;
  const total = items.length;
  const remaining = total - completed;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const jump = (target: JumpTarget) => {
    if (!target) return;
    if (target.kind === 'page') onGoToPage(target.page);
    else if (target.kind === 'cover') onGoToCover();
    else onGoToIncomplete();
  };
  const jumpLabel = (target: JumpTarget): string =>
    target?.kind === 'page' ? `Page ${target.page}` : target?.kind === 'cover' ? 'Open cover' : 'Show';
  const JumpIcon = (target: JumpTarget) =>
    target?.kind === 'cover' ? BookOpen : target?.kind === 'incomplete' ? ImageIcon : MapPin;

  const dateLabel = fmtDate(requestedAt);

  return (
    <div className="border-b border-warning/25 bg-gradient-to-b from-warning/[0.07] to-transparent">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        {/* Header row — always visible */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-warning/12 text-warning ring-1 ring-warning/20">
            <MessageSquareWarning className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-semibold text-foreground">
              Changes requested
              <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning">Revision #{revisionNumber}</span>
              {dateLabel && <span className="text-[12px] font-normal text-muted-foreground">· {dateLabel}</span>}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {total > 0
                ? `${completed} of ${total} addressed · make the changes below, then Resubmit`
                : 'Review the notes below, then Resubmit your album'}
            </p>
          </div>
          {/* Progress ring-ish counter */}
          {total > 0 && (
            <span className="hidden flex-none items-center gap-2 sm:flex">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-warning/15">
                <span className="block h-full rounded-full bg-warning transition-all duration-500 ease-glide" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-[12px] font-medium tabular-nums text-warning">{pct}%</span>
            </span>
          )}
          <ChevronDown className={`h-4 w-4 flex-none text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="mt-3 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            {/* Left — requested changes checklist */}
            <div className="rounded-xl border bg-background/70 p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Requested changes</p>
                {total > 0 && (
                  <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
                    <span><span className="font-semibold text-foreground">{total}</span> requested</span>
                    <span><span className="font-semibold text-studio">{completed}</span> done</span>
                    <span><span className="font-semibold text-warning">{remaining}</span> left</span>
                  </div>
                )}
              </div>
              {total === 0 ? (
                <p className="text-[13px] text-muted-foreground">
                  {requestedChanges?.trim() || 'Our review team asked for a few changes before printing.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((it, i) => {
                    const Icon = JumpIcon(it.target);
                    return (
                      <li key={i} className="group flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/40">
                        <button
                          type="button"
                          onClick={() => toggle(i)}
                          aria-pressed={done[i]}
                          aria-label={done[i] ? 'Mark as not done' : 'Mark as done'}
                          className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-md border transition-colors ${
                            done[i] ? 'border-studio bg-studio text-studio-foreground' : 'border-input bg-background text-transparent hover:border-studio/50'
                          }`}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <span className={`min-w-0 flex-1 text-[13px] leading-snug ${done[i] ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {it.text}
                        </span>
                        {it.target && (
                          <button
                            type="button"
                            onClick={() => jump(it.target)}
                            className="inline-flex flex-none items-center gap-1 rounded-full border border-studio/25 bg-studio-soft px-2 py-0.5 text-[11px] font-medium text-studio opacity-0 transition-all duration-150 hover:bg-studio/15 group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Icon className="h-3 w-3" /> {jumpLabel(it.target)} <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 border-t pt-2.5 text-[12px] text-muted-foreground">
                Reviewed by the <span className="font-medium text-foreground">Malnad review team</span>. Make the changes above,
                then <span className="font-medium text-foreground">Resubmit</span> — you won’t pay again.
              </p>
            </div>

            {/* Right — where you are (timeline) */}
            <div className="rounded-xl border bg-background/70 p-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Where you are</p>
              <ol className="space-y-0">
                {TIMELINE.map((label, i) => {
                  const current = i === TIMELINE.length - 1;
                  return (
                    <li key={label} className="flex gap-2.5">
                      <div className="flex flex-none flex-col items-center">
                        <span className={`grid h-5 w-5 place-items-center rounded-full ${current ? 'bg-warning text-warning-foreground' : 'bg-studio text-studio-foreground'}`}>
                          {current ? <CircleDot className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                        </span>
                        {i < TIMELINE.length - 1 && <span className="my-0.5 w-px flex-1 bg-border" />}
                      </div>
                      <span className={`pb-3 text-[13px] leading-5 ${current ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          {/* Unified diagnostics (Change 1/2/6/7) — the SAME shared component Checkout & Admin use,
              consuming the centralized validation + render-readiness reports. The requested-changes
              checklist above stays as the interactive review element; this adds validation, render
              readiness and grouped print issues so everything lives in one summary. No new logic. */}
          {(validation || renderReadiness) && (
            <PrintDiagnostics audience="customer" validation={validation} render={renderReadiness} onIssueNav={onIssueNav} />
          )}
          </div>
        )}
      </div>
    </div>
  );
}
