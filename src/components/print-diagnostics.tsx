'use client';

import {
  AlertTriangle,
  Check,
  Info,
  CircleAlert,
  ChevronRight,
  Loader2,
  FileWarning,
} from 'lucide-react';
import { type AlbumValidationReport, type IssueAction, type Severity } from '@/lib/albums/validation';
import { type RenderReadinessReport } from '@/lib/albums/render-readiness';
import {
  pdfStageLabel,
  pdfStageStep,
  PDF_STAGE_ORDER,
  pdfFailureLabel,
  pdfFailureCustomerNote,
  pdfFailureRecommendation,
} from '@/lib/pdf/status';

/**
 * SHARED PRINT DIAGNOSTICS (audit Sections 4 & 5) — the ONE component every surface uses to show an
 * album's print status. It is PURELY PRESENTATIONAL: it renders only the reports the centralized
 * systems already produce and contains NO business logic of its own —
 *
 *   • validation → the Central Album Validation Service (`AlbumValidationReport`)
 *   • render     → the Render Readiness layer (`RenderReadinessReport`)
 *   • pdf        → the PDF stage + typed failure code (`album_pdfs` via the poll routes)
 *   • review     → the review workflow (status + requested changes)
 *
 * `audience` switches copy (customer = friendly, never technical; admin = precise, with codes).
 * `onIssueNav` (builder only) makes validation issues clickable, reusing the report's own
 * `IssueAction` navigation targets. Absent → issues are read-only (checkout / admin / server pages).
 */

export type PdfDiag = {
  status: string; // 'idle' | 'generating' | 'ready' | 'failed'
  stage?: string | null;
  failureCode?: string | null;
  generatedAt?: string | null;
  downloadReady?: boolean;
};
export type ReviewDiag = { status: string; requestedChanges?: string | null; revisionNumber?: number };
export type AdminDiag = {
  attempts?: number | null;
  generatedAt?: string | null;
  requestedAt?: string | null;
  workerReady?: boolean;
};

export default function PrintDiagnostics({
  audience,
  validation = null,
  render = null,
  pdf = null,
  review = null,
  onIssueNav,
  admin = null,
  className = '',
}: {
  audience: 'customer' | 'admin';
  validation?: AlbumValidationReport | null;
  render?: RenderReadinessReport | null;
  pdf?: PdfDiag | null;
  review?: ReviewDiag | null;
  onIssueNav?: (action: IssueAction) => void;
  admin?: AdminDiag | null;
  className?: string;
}) {
  const showInfo = audience === 'admin'; // customers don't need advisory 'info' noise
  const validationIssues = validation
    ? [...validation.critical, ...validation.warnings, ...(showInfo ? validation.info : [])]
    : [];

  return (
    <section className={`overflow-hidden rounded-2xl border bg-card ${className}`} aria-label="Print diagnostics">
      {/* Header — overall print readiness */}
      {validation && (
        <header className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Print diagnostics</span>
          <span className="ml-auto flex items-center gap-2">
            <span className={`text-sm font-semibold tabular-nums ${scoreColor(validation.statistics.score)}`}>{validation.statistics.score}%</span>
            <StatusChip ok={validation.printReady} okText="Print ready" badText="Needs attention" />
          </span>
        </header>
      )}

      <div className="divide-y">
        {/* ── Validation (grouped issues) ─────────────────────────────────── */}
        {validation && (
          <Group title="Validation" hint={audience === 'admin' ? 'Album data completeness' : undefined}>
            {validationIssues.length === 0 ? (
              <Passed text={audience === 'customer' ? 'Everything looks ready to print.' : 'No content issues.'} />
            ) : (
              <ul className="space-y-1">
                {validationIssues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    severity={issue.severity}
                    location={locationLabel(issue.page, issue.cover)}
                    title={issue.title}
                    detail={issue.description}
                    onClick={onIssueNav && issue.action ? () => onIssueNav(issue.action) : undefined}
                  />
                ))}
              </ul>
            )}
          </Group>
        )}

        {/* ── Render readiness (SEPARATE from validation — Change 6) ───────── */}
        {render && (
          <Group title="Render readiness" hint={audience === 'admin' ? 'Can the renderer produce it now?' : undefined}>
            {render.renderable ? (
              <Passed text={audience === 'customer' ? 'Your photos and cover are ready to render.' : 'Ready — every referenced asset resolves.'} />
            ) : (
              <ul className="space-y-1">
                {render.issues.map((i, idx) => (
                  <IssueRow
                    key={`${i.code}:${idx}`}
                    severity={i.code === 'photo_not_ready' ? 'warning' : 'critical'}
                    location={locationLabel(i.page, i.cover)}
                    title={renderTitle(i.code)}
                    detail={audience === 'admin' ? `${i.message} (${i.code})` : renderCustomerDetail(i.code)}
                  />
                ))}
              </ul>
            )}
          </Group>
        )}

        {/* ── PDF status (stages + typed failure — Change 7/13) ────────────── */}
        {pdf && pdf.status !== 'idle' && (
          <Group title="Print file (PDF)">
            {pdf.status === 'ready' || pdf.downloadReady ? (
              <Passed text={audience === 'customer' ? 'Your print-ready PDF is available.' : 'Ready — PDF generated and stored.'} />
            ) : pdf.status === 'failed' ? (
              <FailureBlock audience={audience} failureCode={pdf.failureCode} stage={pdf.stage} />
            ) : (
              <StageProgress stage={pdf.stage} />
            )}
          </Group>
        )}

        {/* ── Review (merged into diagnostics — Change 11) ─────────────────── */}
        {review && review.status === 'changes_requested' && (
          <Group title={`Review${review.revisionNumber ? ` · #${review.revisionNumber}` : ''}`}>
            <div className="rounded-lg border border-warning/25 bg-warning/[0.05] p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-warning">
                <FileWarning className="h-4 w-4" /> Changes requested by our review team
              </p>
              {review.requestedChanges && (
                <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-foreground">{review.requestedChanges}</p>
              )}
            </div>
          </Group>
        )}

        {/* ── Admin-only diagnostics footer (Change 9) ─────────────────────── */}
        {audience === 'admin' && admin && (
          <Group title="Pipeline">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
              <Meta label="Worker" value={admin.workerReady == null ? '—' : admin.workerReady ? 'Ready' : 'Offline'} />
              <Meta label="Attempts" value={admin.attempts != null ? String(admin.attempts) : '—'} />
              <Meta label="Last attempt" value={fmt(admin.requestedAt)} />
              <Meta label="Generated" value={fmt(admin.generatedAt)} />
            </dl>
          </Group>
        )}
      </div>
    </section>
  );
}

/* ── sub-components (presentation only) ─────────────────────────────────────── */

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function IssueRow({
  severity,
  location,
  title,
  detail,
  onClick,
}: {
  severity: Severity;
  location: string | null;
  title: string;
  detail: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  const Row = clickable ? 'button' : 'div';
  return (
    <li>
      <Row
        {...(clickable ? { type: 'button' as const, onClick } : {})}
        className={`group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
          clickable ? 'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none' : ''
        }`}
      >
        <SeverityIcon severity={severity} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {location && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sevChip(severity)}`}>{location}</span>}
            <span className="text-[13px] font-medium text-foreground">{title}</span>
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{detail}</span>
        </span>
        {clickable && <ChevronRight className="mt-0.5 h-4 w-4 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
      </Row>
    </li>
  );
}

function StageProgress({ stage }: { stage: string | null | undefined }) {
  const step = pdfStageStep(stage);
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {pdfStageLabel(stage)}…
      </p>
      <div className="mt-2 flex items-center gap-1.5" aria-hidden>
        {PDF_STAGE_ORDER.slice(0, 5).map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i < step ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>
    </div>
  );
}

function FailureBlock({ audience, failureCode, stage }: { audience: 'customer' | 'admin'; failureCode: string | null | undefined; stage: string | null | undefined }) {
  if (audience === 'customer') {
    return (
      <div className="flex items-start gap-2.5">
        <Loader2 className="mt-0.5 h-4 w-4 flex-none animate-spin text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">{pdfFailureCustomerNote(failureCode)}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/[0.05] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">{pdfFailureLabel(failureCode)}</span>
        {failureCode && <code className="text-[11px] text-muted-foreground">{failureCode}</code>}
        {stage && <span className="text-[11px] text-muted-foreground">at {pdfStageLabel(stage).toLowerCase()}</span>}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{pdfFailureRecommendation(failureCode)}</p>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'critical') return <CircleAlert className="mt-0.5 h-4 w-4 flex-none text-destructive" />;
  if (severity === 'warning') return <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" />;
  return <Info className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />;
}

function Passed({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] text-studio">
      <Check className="h-4 w-4" /> {text}
    </p>
  );
}

function StatusChip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ok ? 'bg-studio/10 text-studio' : 'bg-warning/10 text-warning'}`}>
      {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {ok ? okText : badText}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

/* ── pure label helpers (no logic — just formatting) ────────────────────────── */

function locationLabel(page?: number, cover?: 'front' | 'back'): string | null {
  if (cover === 'front') return 'Front cover';
  if (cover === 'back') return 'Back cover';
  if (page != null) return `Page ${page}`;
  return null;
}

function scoreColor(score: number): string {
  return score >= 100 ? 'text-studio' : score >= 50 ? 'text-warning' : 'text-destructive';
}

function sevChip(severity: Severity): string {
  if (severity === 'critical') return 'bg-destructive/10 text-destructive';
  if (severity === 'warning') return 'bg-warning/10 text-warning';
  return 'bg-muted text-muted-foreground';
}

function renderTitle(code: string): string {
  switch (code) {
    case 'photo_not_ready': return 'Photo still processing';
    case 'photo_missing': return 'Photo missing';
    case 'photo_no_asset': return 'Photo file unavailable';
    case 'cover_photo_unresolved': return 'Cover photo unavailable';
    case 'cover_template_missing': return 'Cover design unavailable';
    case 'back_cover_photo_unresolved': return 'Back-cover photo unavailable';
    case 'no_pages': return 'No printable pages';
    default: return 'Not renderable';
  }
}

function renderCustomerDetail(code: string): string {
  switch (code) {
    case 'photo_not_ready': return 'We’re still processing this photo — it’ll be ready in a moment.';
    case 'no_pages': return 'Add some pages before printing.';
    default: return 'We’re preparing this image for print.';
  }
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
