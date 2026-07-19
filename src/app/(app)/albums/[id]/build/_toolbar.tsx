'use client';

import Link from 'next/link';
import { Undo2, Redo2, Frame, Eye, Save, Send, ShoppingCart, ZoomIn, ZoomOut, Maximize2, MoveHorizontal, CheckCircle2, Keyboard, AlignCenterHorizontal, Sparkles, LogOut } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

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
  onBuildForMe,
  onPreview,
  onSave,
  saving,
  onSubmit,
  submitting,
  albumId,
  blueprintMode = false,
  onSaveBlueprint,
  onExitBlueprint,
  blueprintSaving = false,
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
  onBuildForMe: () => void;
  onPreview: () => void;
  onSave: () => void;
  saving: boolean;
  onSubmit: () => void;
  submitting: boolean;
  albumId: string;
  /** Blueprint-edit mode (0046): swaps the customer actions for Save Blueprint / Exit Blueprint. */
  blueprintMode?: boolean;
  onSaveBlueprint?: () => void;
  onExitBlueprint?: () => void;
  blueprintSaving?: boolean;
}) {
  return (
    <div className="flex h-14 flex-none items-center gap-2 border-b border-border/70 bg-card/60 px-3 sm:px-4">
      {/* Identity + status — customer mode only. In Blueprint Mode the dedicated header carries
          identity + save state, so the toolbar is tools-only. */}
      {!blueprintMode && (
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
      )}

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

        {blueprintMode ? (
          /* BLUEPRINT MODE — no customer actions (no Auto Align, Build-for-me, Submit or Checkout).
             Just Preview the template, Save the blueprint, or Exit back to the admin catalog. */
          <>
            <Button variant="outline" size="sm" onClick={onPreview}>
              <Eye /> <span className="hidden sm:inline">Preview</span>
            </Button>
            <Button size="sm" onClick={onSaveBlueprint} disabled={blueprintSaving || !dirty} className={STUDIO_PRIMARY}>
              {blueprintSaving ? <InlineLoader /> : <Save />} <span className="hidden sm:inline">Save Blueprint</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onExitBlueprint} disabled={blueprintSaving}>
              <LogOut /> <span className="hidden sm:inline">Exit Blueprint</span>
            </Button>
          </>
        ) : (
          <>
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

            {/* Build it for me — the hero shortcut into the Blueprint workflow. Emphasized (filled
                studio tint + sparkle) so it reads as the standout tool, without competing with the
                terminal Submit/Checkout CTA. */}
            <Button
              size="sm"
              onClick={onBuildForMe}
              title="Build it for me — auto-arrange your photos from a blueprint"
              className="gap-1.5 border border-studio/25 bg-studio-soft font-semibold text-studio shadow-xs ring-1 ring-inset ring-studio/10 transition-all hover:bg-studio/15 hover:text-studio active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-studio-bright [&_svg]:text-studio"
            >
              <Sparkles /> <span className="hidden sm:inline">Build it for me</span>
            </Button>

            {/* Preview moved to the bottom Pages bar (see _builder.tsx) — kept out of this row. */}
            <Button variant="outline" size="sm" onClick={onSave} disabled={saving || !dirty}>
              {saving ? <InlineLoader /> : <Save />} <span className="hidden sm:inline">Save</span>
            </Button>
            {status === 'submitted' ? (
              <Button size="sm" render={<Link href={`/checkout/${albumId}`} />} className={STUDIO_PRIMARY}>
                <ShoppingCart /> Checkout
              </Button>
            ) : (
              <Button size="sm" onClick={onSubmit} disabled={!complete || submitting} className={STUDIO_PRIMARY}>
                {submitting ? <InlineLoader /> : <Send />}
                {review?.status === 'changes_requested' ? 'Resubmit' : 'Submit'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
