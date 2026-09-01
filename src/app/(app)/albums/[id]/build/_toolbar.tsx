'use client';

import Link from 'next/link';
import { Undo2, Redo2, Frame, Eye, Pencil, Save, Send, ShoppingCart, ZoomIn, ZoomOut, Maximize2, MoveHorizontal, CheckCircle2, Keyboard, AlignCenterHorizontal, Sparkles, LogOut, Settings2 } from 'lucide-react';
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
  onExitPreview,
  previewMode = false,
  onSave,
  saving,
  onSubmit,
  submitting,
  adminEditing = false,
  albumId,
  onOpenSettings,
  reviewMode = false,
  revisionNumber = 1,
  blueprintMode = false,
  onSaveBlueprint,
  onExitBlueprint,
  blueprintSaving = false,
}: {
  title: string;
  status: string;
  review: { status: string } | null;
  dirty: boolean;
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
  /** Leave the preview and return to editing — the other half of the persistent toggle. */
  onExitPreview: () => void;
  /** Which half of the Edit ↔ Preview toggle is active. */
  previewMode?: boolean;
  onSave: () => void;
  saving: boolean;
  onSubmit: () => void;
  submitting: boolean;
  /**
   * An ADMINISTRATOR is editing a customer's album. Hides the two CUSTOMER terminal actions —
   * Submit (which is a customer's own RLS-scoped action and would simply fail for an admin) and
   * Checkout (buying someone else's book). Save stays, because saving is the point.
   *
   * Not a permission: the server refuses both regardless of what this renders.
   */
  adminEditing?: boolean;
  albumId: string;
  /** Open the Album Settings hub (General / Format / Photos / Builder). Customer mode only. */
  onOpenSettings?: () => void;
  /** Review Revision Mode (CHANGE 2/3/7): paid album reopened for requested changes → no Checkout,
   *  Resubmit is the primary action, and one consolidated workflow status chip. */
  reviewMode?: boolean;
  revisionNumber?: number;
  /** Blueprint-edit mode (0046): swaps the customer actions for Save Blueprint / Exit Blueprint. */
  blueprintMode?: boolean;
  onSaveBlueprint?: () => void;
  onExitBlueprint?: () => void;
  blueprintSaving?: boolean;
}) {
  // On phone the fixed-width tool groups exceed 375px, which squeezed the identity block to zero
  // width and let its title and save chip spill out from under the bar. Below md the bar becomes
  // a horizontally scrollable strip: the title keeps a readable minimum and truncates, every tool
  // group stays at its designed size, and nothing is hidden — a tool strip is the one place a
  // scroll is the honest answer, because the alternative is removing tools. `ms-scroll` matches
  // the thin scrollbar used elsewhere in the builder. At md and up the bar is unchanged.
  return (
    <div className="ms-scroll flex h-14 flex-none items-center gap-2 overflow-x-auto border-b border-border/70 bg-card/60 px-3 max-md:gap-1.5 max-md:px-2 sm:px-4 xl:overflow-x-visible">
      {/* Identity + status — customer mode only. In Blueprint Mode the dedicated header carries
          identity + save state, so the toolbar is tools-only. */}
      {!blueprintMode && (
      <div className="flex min-w-0 items-center gap-2 max-md:min-w-[7rem] max-md:shrink">
        <h1 className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground max-md:min-w-[4.5rem]">{title}</h1>
        {reviewMode ? (
          /* ONE consolidated workflow status chip (replaces competing Submitted + review pills). */
          <span className="hidden items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-warning/20 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Changes requested · Review #{revisionNumber}
          </span>
        ) : (
          <>
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
          </>
        )}
        {/* Save status (CHANGE 7) — never leave the user guessing: Saving… / Unsaved / All changes saved. */}
        <span
          // flex-none + nowrap: in the phone scroll strip this chip was being compressed
          // until 'All changes saved' wrapped onto three lines and grew the bar.
          className={`inline-flex items-center gap-1 rounded-full max-md:flex-none max-md:whitespace-nowrap px-2 py-0.5 text-[11px] font-medium ${
            saving
              ? 'bg-studio/10 text-studio ring-1 ring-studio/20'
              : dirty
                ? 'bg-warning/10 text-warning ring-1 ring-warning/20'
                : 'bg-secondary text-muted-foreground ring-1 ring-border/60'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${saving ? 'animate-pulse bg-studio' : dirty ? 'animate-pulse bg-warning' : 'bg-studio'}`} />
          {saving ? 'Saving…' : dirty ? 'Unsaved' : 'All changes saved'}
        </span>
      </div>
      )}

      {/* Right cluster — editing tools (shared across the cover + content pages). */}
      <div className="ml-auto flex items-center gap-2 max-md:flex-none max-md:gap-1.5">
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

        {/*
          THE EDIT ↔ PREVIEW TOGGLE — persistent, always visible, one control.

          Designers live in this switch, so it is a real segmented control rather than a button
          that opens a thing: both destinations are on screen at all times and the current one is
          always the highlighted half. Switching is instantaneous because the builder never
          unmounts — the preview opens over it — so the spread, zoom, scroll position and
          selection are all exactly where they were on the way back.
        */}
        <div className="inline-flex rounded-xl border bg-card p-0.5 shadow-xs" role="group" aria-label="Edit or preview">
          <button
            type="button"
            onClick={onExitPreview}
            aria-pressed={!previewMode}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
              previewMode ? 'text-muted-foreground hover:text-foreground' : 'bg-secondary text-foreground shadow-xs'
            }`}
          >
            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
          </button>
          <button
            type="button"
            onClick={onPreview}
            aria-pressed={previewMode}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
              previewMode ? 'bg-secondary text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Preview</span>
          </button>
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
            {onOpenSettings && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenSettings}
                title="Album Settings — name, format, photos & build options"
                className="text-muted-foreground hover:text-foreground"
              >
                <Settings2 /> <span className="hidden lg:inline">Album Settings</span>
              </Button>
            )}
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
            {adminEditing ? (
              /* An admin's terminal action is Save, then Generate PDF / Approve back in the admin
                 console — neither Submit nor Checkout belongs to them. */
              null
            ) : reviewMode ? (
              /* Review Revision Mode (CHANGE 2/3/7): the album is already paid — NO Checkout.
                 Resubmit is the primary action; it runs the SAME central validation + dialog as Submit. */
              <Button size="sm" onClick={onSubmit} disabled={submitting} className={STUDIO_PRIMARY}>
                {submitting ? <InlineLoader /> : <Send />} <span className="hidden sm:inline">Resubmit album</span><span className="sm:hidden">Resubmit</span>
              </Button>
            ) : status === 'submitted' ? (
              <Button size="sm" render={<Link href={`/checkout/${albumId}`} />} className={STUDIO_PRIMARY}>
                <ShoppingCart /> Checkout
              </Button>
            ) : (
              // Always clickable — validation now INFORMS via a dialog instead of blocking.
              <Button size="sm" onClick={onSubmit} disabled={submitting} className={STUDIO_PRIMARY}>
                {submitting ? <InlineLoader /> : <Send />}
                Submit
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
