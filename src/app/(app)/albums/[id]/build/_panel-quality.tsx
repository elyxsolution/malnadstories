'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Crop,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Loader2,
  ScanLine,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { AlbumStatistics, IssueKind, QualityIssue, QualityReport } from './_quality-model';

/**
 * THE ALBUM QUALITY INSPECTOR — a panel, not a gate.
 *
 * The brief for this phase was "reduce mistakes without interrupting". Those two goals are
 * usually in tension, and the resolution is architectural rather than cosmetic: quality lives in
 * a dockable rail panel that the photographer opens when they want it, next to the tray and the
 * layouts they already use. It never opens itself, never blocks a save, never confirms anything.
 * The only thing it does that a passive list can't is NAVIGATE — every row hands you the exact
 * frame it's talking about, which is the difference between "12 issues" and a fixable album.
 *
 * WHY THE ROWS ARE AGGREGATED. The engine could emit one row per empty frame; a blank 48-page
 * album would then produce ninety-six of them and the panel would be useless precisely when it
 * matters most. So spread-level facts are rolled up in `_quality-model` and the panel renders
 * what it is given — one row per spread, with a count. Per-frame detail is on the canvas, as a
 * badge, where the frame itself is.
 *
 * TONE. Two severities, and neither is red. `attention` is amber and phrased as a consequence
 * ("prints as blank paper"), `notice` is grey and phrased as a question ("intentional, or still
 * to fill?"). Nothing here is an error, because nothing here is wrong — it is someone's album,
 * mid-edit.
 */

const KIND_ICON: Record<IssueKind, typeof AlertTriangle> = {
  'empty-frame': LayoutGrid,
  'empty-spread': LayoutGrid,
  'low-resolution': ScanLine,
  'extreme-crop': Crop,
  'duplicate-photo': Copy,
  'cover-photo': ImageIcon,
  processing: Loader2,
  'upload-failed': UploadCloud,
};

function IssueRow({ issue, onGo }: { issue: QualityIssue; onGo: (i: QualityIssue) => void }) {
  const Icon = KIND_ICON[issue.kind];
  const attention = issue.severity === 'attention';
  return (
    <button
      type="button"
      onClick={() => onGo(issue)}
      className="group flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-all duration-150 ease-glide hover:border-border/70 hover:bg-secondary/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
    >
      <span
        className={`mt-px grid h-6 w-6 flex-none place-items-center rounded-md ${
          attention ? 'bg-warning/15 text-warning' : 'bg-secondary text-muted-foreground'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-snug tracking-tight text-foreground">{issue.title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{issue.detail}</span>
      </span>
      <ChevronRight className="mt-1 h-3.5 w-3.5 flex-none text-muted-foreground/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}

function Stat({ label, value, hint, tone = 'plain' }: { label: string; value: string | number; hint?: string; tone?: 'plain' | 'warning' | 'good' }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
      <div
        className={`text-[17px] font-semibold leading-none tabular-nums ${
          tone === 'warning' ? 'text-warning' : tone === 'good' ? 'text-studio' : 'text-foreground'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/** A three-part bar for the portrait / landscape / square mix. Zero-width segments vanish. */
function ShapeBar({ orientation }: { orientation: AlbumStatistics['orientation'] }) {
  const total = orientation.portrait + orientation.landscape + orientation.square + orientation.unknown;
  if (total === 0) return null;
  const segments = [
    { key: 'portrait', n: orientation.portrait, cls: 'bg-studio', label: 'Portrait' },
    { key: 'landscape', n: orientation.landscape, cls: 'bg-studio/55', label: 'Landscape' },
    { key: 'square', n: orientation.square, cls: 'bg-studio/30', label: 'Square' },
    { key: 'unknown', n: orientation.unknown, cls: 'bg-muted-foreground/25', label: 'Unknown' },
  ].filter((s) => s.n > 0);

  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary" role="img" aria-label={segments.map((s) => `${s.label} ${s.n}`).join(', ')}>
        {segments.map((s) => (
          <span key={s.key} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${s.cls}`} aria-hidden />
            {s.label} <span className="font-medium tabular-nums text-foreground">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function QualityPanel({
  report,
  stats,
  onGoToIssue,
  onOpenReview,
}: {
  report: QualityReport;
  stats: AlbumStatistics;
  onGoToIssue: (issue: QualityIssue) => void;
  /** Enter the distraction-free review mode — the natural next step from a clean report. */
  onOpenReview: () => void;
}) {
  const [showNotices, setShowNotices] = useState(true);

  return (
    <div className="ms-scroll flex-1 space-y-5 overflow-y-auto p-4">
      {/* ── headline ───────────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Album quality</h2>
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-studio transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-1"
          >
            <Sparkles className="h-3 w-3" /> Review mode
          </button>
        </div>

        {report.clean ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-studio/25 bg-studio-soft px-3 py-2.5">
            <CheckCircle2 className="mt-px h-4 w-4 flex-none text-studio" />
            <div>
              <p className="text-[12.5px] font-medium leading-snug text-studio">Nothing needs your attention.</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Every frame is filled and sharp enough to print at this size.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/[0.07] px-3 py-2.5">
            <AlertTriangle className="mt-px h-4 w-4 flex-none text-warning" />
            <div>
              <p className="text-[12.5px] font-medium leading-snug text-foreground">
                {report.attention.length} {report.attention.length === 1 ? 'thing' : 'things'} worth fixing before you print.
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Nothing is blocked — you can keep editing and come back to these.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── worth fixing ───────────────────────────────────────────────────────── */}
      {report.attention.length > 0 && (
        <section>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Worth fixing
          </p>
          <div className="space-y-0.5">
            {report.attention.map((i) => (
              <IssueRow key={i.id} issue={i} onGo={onGoToIssue} />
            ))}
          </div>
        </section>
      )}

      {/* ── worth a look ───────────────────────────────────────────────────────── */}
      {report.notices.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowNotices((v) => !v)}
            aria-expanded={showNotices}
            className="mb-1 flex w-full items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-150 ${showNotices ? 'rotate-90' : ''}`}
              aria-hidden
            />
            Worth a look · {report.notices.length}
          </button>
          {showNotices && (
            <div className="space-y-0.5">
              {report.notices.map((i) => (
                <IssueRow key={i.id} issue={i} onGo={onGoToIssue} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── statistics ─────────────────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          This album
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Photos" value={stats.totalPhotos} hint={`${stats.usedPhotos} in the book`} />
          <Stat
            label="Unused"
            value={stats.unusedPhotos}
            tone={stats.unusedPhotos > 0 ? 'plain' : 'good'}
            hint={stats.unusedPhotos > 0 ? 'still in your tray' : 'all placed'}
          />
          <Stat
            label="Spreads done"
            value={`${stats.spreadsComplete}/${stats.spreads}`}
            tone={stats.spreadsIncomplete > 0 ? 'warning' : 'good'}
            hint={stats.spreadsIncomplete > 0 ? `${stats.spreadsIncomplete} incomplete` : 'every spread filled'}
          />
          <Stat label="Per spread" value={stats.photosPerSpread} hint="photos on average" />
          <Stat
            label="Frames"
            value={`${stats.framesFilled}/${stats.framesTotal}`}
            hint="filled of available"
          />
          <Stat
            label="Repeated"
            value={stats.duplicatedPhotos}
            tone={stats.duplicatedPhotos > 0 ? 'plain' : 'good'}
            hint={stats.duplicatedPhotos > 0 ? 'used more than once' : 'no repeats'}
          />
        </div>

        <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-card px-2.5 py-2.5">
          <p className="text-[11px] font-medium text-foreground">Shape mix</p>
          {stats.usedPhotos > 0 ? (
            <ShapeBar orientation={stats.orientation} />
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Place a few photos and the mix of portrait, landscape and square frames appears here.
            </p>
          )}
        </div>

        {/* Upload progress is only shown while it MEANS something — a finished import needs no bar. */}
        {(stats.upload.processing > 0 || stats.upload.failed > 0) && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium text-foreground">Import progress</p>
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{stats.upload.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-studio transition-[width] duration-500 ease-glide"
                style={{ width: `${stats.upload.percent}%` }}
              />
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              {stats.upload.ready} ready
              {stats.upload.processing > 0 ? ` · ${stats.upload.processing} preparing` : ''}
              {stats.upload.failed > 0 ? ` · ${stats.upload.failed} failed` : ''}
            </p>
          </div>
        )}
      </section>

      <p className="flex items-start gap-1.5 px-2 pb-2 text-[10.5px] leading-relaxed text-muted-foreground/80">
        <Info className="mt-px h-3 w-3 flex-none" aria-hidden />
        Resolution is measured against this album&rsquo;s printed page size, so the same photo can be
        perfect in a small frame and soft across a full spread.
      </p>
    </div>
  );
}
