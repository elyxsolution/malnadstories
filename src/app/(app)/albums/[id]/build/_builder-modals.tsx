'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, MessageSquareWarning, Save } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { Button } from '@/components/ui/button';
import type { Photo } from '@/lib/builder/photo';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { EditConfig } from '@/lib/builder/model';
import type { CoverConfig } from '@/lib/builder/cover';
import PhotoEditor from './_photo-editor';
import QuickCrop from './_quick-crop';
import type { CoverSide } from './_cover-canvas';
import { STUDIO_PRIMARY } from './_ui';

/**
 * BUILDER MODAL HOST — the overlays the builder can open, lifted out of the orchestrator.
 *
 * Deliberately THREE cohesive components rather than one "modal host" taking forty props. A
 * single host would have moved the code without reducing the coupling: it would still need every
 * piece of builder state, just passed through an extra boundary. Grouping by what the modals
 * actually share — photo editing, submission feedback, exit guarding — keeps each prop list
 * small enough to read.
 *
 * All three are presentational. Every decision (what is open, what happens on confirm) stays
 * with the orchestrator; behaviour is unchanged from the inline versions.
 */

// ── photo editing ────────────────────────────────────────────────────────────────

export type QuickCropTarget = { photo: Photo; aspect: number; gutter: boolean };

/**
 * The three photo editors, which are mutually exclusive in practice but share the same
 * dependencies: a photo, its frame aspect, and where the saved `EditConfig` should land.
 */
export function PhotoModals({
  editingPhoto,
  editPlacement,
  onCloseEditor,
  onPhotoSaved,
  coverImageEditor,
  coverConfig,
  photoMap,
  pageAspect,
  onCloseCoverEditor,
  onCoverImageEdit,
  quickCrop,
  onCloseQuickCrop,
}: {
  editingPhoto: Photo | null;
  editPlacement: { aspect: number; gutter: boolean };
  onCloseEditor: () => void;
  onPhotoSaved: (photoId: string, edit: EditConfig) => void;
  /** Which cover face is being edited, or null. */
  coverImageEditor: CoverSide | null;
  coverConfig: CoverConfig;
  photoMap: Map<string, Photo>;
  pageAspect: number;
  onCloseCoverEditor: () => void;
  onCoverImageEdit: (side: CoverSide, edit: EditConfig) => void;
  quickCrop: QuickCropTarget | null;
  onCloseQuickCrop: () => void;
}) {
  const coverPhotoId = coverImageEditor
    ? coverImageEditor === 'front'
      ? coverConfig.photoId
      : coverConfig.back.photoId
    : null;
  const coverPhoto = coverPhotoId ? photoMap.get(coverPhotoId) : undefined;

  return (
    <>
      {editingPhoto && (
        <PhotoEditor
          photoId={editingPhoto.id}
          url={resolvePhotoUrl(editingPhoto, 'full') ?? ''}
          filename={editingPhoto.filename}
          initial={editingPhoto.edit}
          frameAspect={editPlacement.aspect}
          showGutter={editPlacement.gutter}
          onClose={onCloseEditor}
          onSaved={(edit) => onPhotoSaved(editingPhoto.id, edit)}
        />
      )}

      {coverImageEditor && coverPhoto && (
        <PhotoEditor
          photoId={coverPhoto.id}
          url={resolvePhotoUrl(coverPhoto, 'full') ?? ''}
          filename={coverPhoto.filename}
          initial={coverImageEditor === 'front' ? coverConfig.imageEdit : coverConfig.back.imageEdit}
          frameAspect={pageAspect}
          showGutter={false}
          onClose={onCloseCoverEditor}
          onSaved={(edit) => onCoverImageEdit(coverImageEditor, edit)}
        />
      )}

      {quickCrop && (
        <QuickCrop
          photoId={quickCrop.photo.id}
          url={resolvePhotoUrl(quickCrop.photo, 'full') ?? ''}
          filename={quickCrop.photo.filename}
          initial={quickCrop.photo.edit}
          frameAspect={quickCrop.aspect}
          showGutter={quickCrop.gutter}
          onClose={onCloseQuickCrop}
          onSaved={(edit) => onPhotoSaved(quickCrop.photo.id, edit)}
        />
      )}
    </>
  );
}

// ── submission feedback ──────────────────────────────────────────────────────────

/** Shown after a review-mode resubmit: the album is back with the review team, no re-charge. */
export function ResubmittedDialog() {
  const router = useRouter();
  return (
    <div className="animate-fade-in fixed inset-0 z-[130] flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm">
      <div className="animate-scale-in w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-elevated">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-studio/[0.1] text-studio ring-1 ring-studio/15">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h2 className="mt-3 font-display text-xl font-semibold tracking-tight">Resubmitted for review</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          Thanks — your album is back with our review team. We’ll take another look and email you when it’s ready to
          print. <span className="font-medium text-foreground">You won’t be charged again.</span>
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button className={STUDIO_PRIMARY} onClick={() => router.push('/reviews')}>
            View review status
          </Button>
          <Button variant="ghost" onClick={() => router.push('/dashboard')}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── exit guarding ────────────────────────────────────────────────────────────────

/** The unsaved-changes guard: Save & leave (full flush) / Leave without saving / Cancel. */
export function ExitGuardDialog({
  reviewMode,
  exiting,
  error,
  onSaveAndLeave,
  onLeaveWithout,
  onCancel,
}: {
  reviewMode: boolean;
  exiting: boolean;
  /** Surfaced in the dialog when a Save & leave attempt failed. */
  error: string | null;
  onSaveAndLeave: () => void;
  onLeaveWithout: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[130] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
      onClick={() => !exiting && onCancel()}
    >
      <div
        className="animate-scale-in w-full max-w-md rounded-2xl border bg-background p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-warning/10 text-warning">
          <MessageSquareWarning className="h-5 w-5" />
        </span>
        <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">
          {reviewMode ? 'Leave the review for now?' : 'Leave the builder?'}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {reviewMode ? (
            <>
              You still have requested changes to finish. Save your progress and you can pick up right where you left
              off — your album stays in review and <span className="font-medium text-foreground">you won’t pay again.</span>
            </>
          ) : (
            'You have unsaved changes. Save your progress before leaving — if you leave now, your most recent changes may be lost.'
          )}
        </p>
        {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={onSaveAndLeave} disabled={exiting} className={STUDIO_PRIMARY}>
            {exiting ? <InlineLoader /> : <Save className="h-4 w-4" />} Save &amp; leave
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onLeaveWithout} disabled={exiting}>
              Leave without saving
            </Button>
            <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={exiting}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
