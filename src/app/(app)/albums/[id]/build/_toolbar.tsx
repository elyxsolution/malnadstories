'use client';

import Link from 'next/link';
import {
  Undo2,
  Redo2,
  Frame,
  Eye,
  Save,
  Send,
  Loader2,
  ShoppingCart,
  ZoomIn,
  ZoomOut,
  Maximize2,
  MoveHorizontal,
  CheckCircle2,
  Keyboard,
  AlignCenterHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STUDIO_PRIMARY } from './_ui';
import { reviewStatusLabel, reviewStatusChip } from '@/lib/reviews/model';

/**
 * The canvas toolbar (Part 2 "CONTROLS"): history, zoom, guides, preview, save, submit.
 * Identity + progress live in the header above; this row is strictly the editor's controls.
 */
export default function CanvasToolbar({
  title,
  status,
  review,
  dirty,
  complete,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showGuides,
  onToggleGuides,
  onShortcuts,
  zoomPct,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onActualSize,
  onAutoAlign,
  canAutoAlign,
  onPreview,
  onSave,
  saving,
  onSubmit,
  submitting,
  albumId,
}: {
  title: string;
  status: string;
  review: { status: string } | null;
  dirty: boolean;
  complete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showGuides: boolean;
  onToggleGuides: () => void;
  onShortcuts: () => void;
  zoomPct: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onActualSize: () => void;
  onAutoAlign: () => void;
  canAutoAlign: boolean;
  onPreview: () => void;
  onSave: () => void;
  saving: boolean;
  onSubmit: () => void;
  submitting: boolean;
  albumId: string;
}) {
  return (
    <div className="flex h-14 flex-none items-center gap-2 border-b border-border/70 bg-card/60 px-3 sm:px-4">
      {/* Identity + status */}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
        {status === 'submitted' && (
          <span className="hidden items-center gap-1 rounded-full bg-studio-soft px-2 py-0.5 text-[11px] font-semibold text-studio ring-1 ring-studio/20 sm:inline-flex">
            <CheckCircle2 className="h-3 w-3" /> Submitted
          </span>
        )}
        {review && (
          <span className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold lg:inline-flex ${reviewStatusChip(review.status)}`}>
            {reviewStatusLabel(review.status)}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            dirty ? 'bg-warning/10 text-warning ring-1 ring-warning/20' : 'bg-secondary text-muted-foreground ring-1 ring-border/60'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dirty ? 'animate-pulse bg-warning' : 'bg-studio'}`} />
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      {/* Right cluster — editing tools (shared across the cover + content pages). */}
      <div className="ml-auto flex items-center gap-2">
        <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs">
          <Button variant="ghost" size="icon-sm" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (⌘Z)">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (⌘⇧Z)">
            <Redo2 />
          </Button>
          <span className="mx-0.5 my-1 w-px bg-border" />
          <Button variant={showGuides ? 'secondary' : 'ghost'} size="icon-sm" onClick={onToggleGuides} aria-label="Toggle guides" title="Guides (G)">
            <Frame />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onShortcuts} aria-label="Shortcuts" title="Shortcuts (?)">
            <Keyboard />
          </Button>
        </div>

        <div className="hidden items-center rounded-xl border bg-card p-0.5 shadow-xs md:inline-flex">
            <Button variant="ghost" size="icon-sm" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">
              <ZoomOut />
            </Button>
            <button
              type="button"
              onClick={onActualSize}
              className="min-w-[3rem] rounded-md px-1 py-1 text-[12px] font-medium tabular-nums text-foreground transition-colors hover:bg-secondary"
              title="Actual size (100%)"
            >
              {zoomPct}%
            </button>
            <Button variant="ghost" size="icon-sm" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">
              <ZoomIn />
            </Button>
            <span className="mx-0.5 my-1 w-px bg-border" />
            <Button variant="ghost" size="icon-sm" onClick={onFitWidth} aria-label="Fit width" title="Fit width">
              <MoveHorizontal />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onActualSize} aria-label="Fit page" title="Fit page">
              <Maximize2 />
            </Button>
          </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onAutoAlign}
          disabled={!canAutoAlign}
          title="Auto Align — tidy this page's text & stickers"
          className="border-studio/30 text-studio hover:border-studio/50 hover:bg-studio-soft hover:text-studio focus-visible:ring-studio-bright [&_svg]:text-studio"
        >
          <AlignCenterHorizontal /> <span className="hidden sm:inline">Auto Align</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye /> <span className="hidden sm:inline">Preview</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onSave} disabled={saving || !dirty}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} <span className="hidden sm:inline">Save</span>
        </Button>
        {status === 'submitted' ? (
          <Button size="sm" render={<Link href={`/checkout/${albumId}`} />} className={STUDIO_PRIMARY}>
            <ShoppingCart /> Checkout
          </Button>
        ) : (
          <Button size="sm" onClick={onSubmit} disabled={!complete || submitting} className={STUDIO_PRIMARY}>
            {submitting ? <Loader2 className="animate-spin" /> : <Send />}
            {review?.status === 'changes_requested' ? 'Resubmit' : 'Submit'}
          </Button>
        )}
      </div>
    </div>
  );
}
