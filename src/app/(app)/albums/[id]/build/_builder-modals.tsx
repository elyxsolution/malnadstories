'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MessageSquareWarning, Save, X, ArrowRight, Plus } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { Button } from '@/components/ui/button';
import type { Photo } from '@/lib/builder/photo';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import type { EditConfig } from '@/lib/builder/model';
import type { CoverConfig } from '@/lib/builder/cover';
import PhotoEditor from './_photo-editor';
import QuickCrop from './_quick-crop';
import type { CoverSide } from './_cover-canvas';
import type { FrameRef } from './_frame-ref';
import { STUDIO_PRIMARY } from './_ui';
import { ensureAlbumInCart } from '@/lib/actions/cart';

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
  frameRef = null,
  frameEdit = null,
  onFrameSaved,
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
  /**
   * THE FRAME the album-photo modals are editing, when they were opened from one.
   *
   * `null` means the tray opened them, so they edit the SOURCE photo exactly as before. A frame
   * reference means they edit that PLACEMENT: `frameEdit` seeds the dialog with what that frame
   * is actually showing (its own edit, or the inherited source default), and `onFrameSaved`
   * writes it back to that frame alone.
   */
  frameRef?: FrameRef | null;
  frameEdit?: EditConfig | null;
  onFrameSaved?: (ref: FrameRef, edit: EditConfig) => void;
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
          /* The FRAME's picture when one opened this, the source photo's otherwise. */
          initial={frameRef ? frameEdit : editingPhoto.edit}
          frameAspect={editPlacement.aspect}
          showGutter={editPlacement.gutter}
          onClose={onCloseEditor}
          onSaved={(edit) =>
            frameRef && onFrameSaved ? onFrameSaved(frameRef, edit) : onPhotoSaved(editingPhoto.id, edit)
          }
          /* A placement edit is layout state — it rides the builder's existing debounced save
             rather than writing the shared `photos` row, which every other placement reads. */
          persist={frameRef ? async () => ({ ok: true }) : undefined}
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
          initial={frameRef ? frameEdit : quickCrop.photo.edit}
          frameAspect={quickCrop.aspect}
          showGutter={quickCrop.gutter}
          onClose={onCloseQuickCrop}
          onSaved={(edit) =>
            frameRef && onFrameSaved ? onFrameSaved(frameRef, edit) : onPhotoSaved(quickCrop.photo.id, edit)
          }
          persist={frameRef ? async () => ({ ok: true }) : undefined}
        />
      )}
    </>
  );
}

// ── submission feedback ──────────────────────────────────────────────────────────

/**
 * AFTER A SUCCESSFUL SUBMISSION — where do you want to go?
 *
 * A submission used to end in a toast, which said what happened and nothing about what to do
 * next, so the two things a customer actually wants — buy this book, or start the next one —
 * were both a hunt. This offers exactly those two, and a way out of the question.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────────────────
 *
 * It invents no flow. "Proceed to checkout" is the existing `/checkout/[albumId]` route the
 * toolbar's own button links to; "create one more album" is the existing `/albums/new` wizard.
 * The submission is already complete and already persisted before this opens, so nothing here can
 * undo it and nothing here is required for it to have counted.
 *
 * ── THE CLOSE BUTTON IS A REAL THIRD ANSWER ────────────────────────────────────────────────
 *
 * The ✕ dismisses the dialog and does NOTHING else: it does not delete the album, does not revert
 * the submission, and does not add anything to the cart. It is not a "cancel" — there is nothing
 * pending to cancel — which is why it is a quiet icon in the corner rather than a third button
 * competing with the two real choices. Escape and a click on the backdrop do the same thing, and
 * neither can reach an action: both call `onClose`, and the two action handlers are only ever
 * reached from their own buttons.
 *
 * Focus moves to the primary action on open and is trapped between the three controls, so the
 * dialog is operable from the keyboard and cannot leak focus back to the canvas behind it.
 */
export function SubmittedDialog({
  albumId,
  onClose,
}: {
  albumId: string;
  /** Dismiss. Never called by either action — see above. */
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'checkout' | 'another'>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Focus the PRIMARY action, not the ✕ that happens to come first in the DOM. Located by a data
     attribute rather than a ref because `Button` is a plain function component (no forwardRef). */
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  // Escape closes; Tab is contained. Both are plain dismissal — no action can be triggered here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);

  const goCheckout = () => {
    setBusy('checkout');
    router.push(`/checkout/${albumId}`);
  };

  /**
   * ENSURE, NOT INCREMENT. `submitAlbum` has already best-effort put this album in the cart, so
   * incrementing would leave the customer buying two copies of a book they asked to buy once —
   * and the auto-add is best-effort, so it also cannot simply be assumed to have worked.
   * `ensureAlbumInCart` is the action-level door to `cart_ensure_item` (ON CONFLICT DO NOTHING).
   *
   * The new album is created by the existing `/albums/new` wizard — a genuinely new album with a
   * new id and its own fresh builder state. Nothing about the submitted album is reused or
   * overwritten: this component holds no builder state and mutates none.
   */
  const goAnother = async () => {
    setBusy('another');
    setError(null);
    const res = await ensureAlbumInCart({ albumId, quantity: 1 });
    if (!res.ok) {
      // The album IS submitted regardless — say what failed and let them choose again rather
      // than navigating away from a cart that does not contain what they were told it does.
      setError(res.error);
      setBusy(null);
      return;
    }
    router.push('/albums/new');
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[130] flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-submitted-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-scale-in relative w-full max-w-md rounded-2xl border bg-background p-6 text-center shadow-elevated"
      >
        {/* THE WAY OUT. Top-right, 44px hit area on touch, and wired to nothing but dismissal. */}
        <button
          type="button"
          onClick={onClose}
          disabled={!!busy}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright active:scale-[0.97] disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>

        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-studio/[0.1] text-studio ring-1 ring-studio/15">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h2 id="album-submitted-title" className="mt-3 font-display text-xl font-semibold tracking-tight">
          Album submitted
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          It’s with our review team now. You can keep editing it right up until you place an order.
        </p>

        {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

        <div className="mt-5 flex flex-col gap-2">
          <Button data-autofocus className={STUDIO_PRIMARY} onClick={goCheckout} disabled={!!busy}>
            {busy === 'checkout' ? <InlineLoader /> : null} Proceed to checkout <ArrowRight />
          </Button>
          <Button variant="outline" onClick={goAnother} disabled={!!busy}>
            {busy === 'another' ? <InlineLoader /> : <Plus />} Add to cart &amp; create one more album
          </Button>
        </div>
      </div>
    </div>
  );
}

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
