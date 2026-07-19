'use client';

import { AlertTriangle, XCircle, Info, ArrowLeft, Send, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import type { AlbumValidationReport, ValidationIssue, IssueAction, IssueCategory } from '@/lib/albums/validation';

/**
 * Album Review dialog (informs — never blocks). Groups issues by section, shows a 0–100 readiness
 * score, and makes every issue a one-click jump into the exact place that needs attention. When
 * the album is fully valid it is skipped by the caller (submission proceeds directly).
 *
 * "Submit Anyway" only appears when the album is NOT print-ready; the caller then shows a
 * confirmation before the album is submitted (CHANGE 7).
 */
const GROUPS: { key: IssueCategory | 'cover'; label: string }[] = [
  { key: 'cover', label: 'Cover' },
  { key: 'pages', label: 'Pages' },
  { key: 'photos', label: 'Photos' },
  { key: 'layout', label: 'Layout' },
  { key: 'structure', label: 'Album' },
];

const SEV_ICON: Record<ValidationIssue['severity'], React.ReactNode> = {
  critical: <XCircle className="mt-0.5 h-4 w-4 flex-none text-destructive" />,
  warning: <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" />,
  info: <Info className="mt-0.5 h-4 w-4 flex-none text-studio" />,
};

function scoreTone(score: number): string {
  if (score >= 100) return 'text-success';
  if (score >= 80) return 'text-studio';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

export default function SubmitValidationDialog({
  report,
  submitting,
  onGoBack,
  onNavigate,
  onContinue,
}: {
  report: AlbumValidationReport;
  submitting: boolean;
  onGoBack: () => void;
  onNavigate: (action: IssueAction) => void;
  onContinue: () => void;
}) {
  const { statistics: s, printReady } = report;
  const total = report.issues.length;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Album review">
      <div className="animate-rise flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-background shadow-elevated" onClick={(e) => e.stopPropagation()}>
        {/* Header — title + readiness score */}
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">Album Review</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {total} {total === 1 ? 'item' : 'items'} to review · {printReady ? 'ready to print' : 'not print-ready yet'}
            </p>
          </div>
          <div className="text-right">
            <div className={`font-display text-2xl font-semibold tabular-nums ${scoreTone(s.score)}`}>{s.score}%</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">ready</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full bg-muted">
          <div className={`h-full rounded-r-full transition-all ${s.score >= 100 ? 'bg-success' : s.score >= 50 ? 'bg-studio' : 'bg-warning'}`} style={{ width: `${s.score}%` }} />
        </div>

        {/* Grouped issues */}
        <div className="ms-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/30 p-3 text-center text-sm">
            <Stat label="Pages" value={`${s.currentPages} / ${s.expectedPages}`} bad={s.currentPages !== s.expectedPages} />
            <Stat label="Photos placed" value={`${s.placedPhotos} / ${s.expectedPhotos}`} bad={s.missingPhotos > 0} />
          </div>

          {GROUPS.map((g) => {
            const groupIssues = report.issues.filter((i) => i.category === g.key);
            if (groupIssues.length === 0) return null;
            return (
              <div key={g.key}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{g.label}</p>
                <ul className="space-y-1">
                  {groupIssues.map((issue) => (
                    <li key={issue.id}>
                      <button
                        type="button"
                        onClick={() => issue.action && onNavigate(issue.action)}
                        disabled={!issue.action}
                        className={`group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                          issue.action ? 'hover:bg-accent' : 'cursor-default'
                        }`}
                      >
                        {SEV_ICON[issue.severity]}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{issue.title}</span>
                          <span className="block text-xs text-muted-foreground">{issue.description}</span>
                        </span>
                        {issue.action && <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={onGoBack} disabled={submitting}>
            <ArrowLeft className="h-4 w-4" /> Go Back &amp; Edit
          </Button>
          <Button size="sm" className={LUX_PRIMARY} onClick={onContinue} disabled={submitting}>
            {submitting ? <InlineLoader /> : <Send className="h-4 w-4" />} {printReady ? 'Submit' : 'Submit Anyway'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${bad ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
    </div>
  );
}
