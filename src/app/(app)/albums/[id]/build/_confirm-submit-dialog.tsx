'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';

/**
 * Confirmation before submitting a NOT-print-ready album (CHANGE 7). Prevents accidental
 * submission of incomplete albums while keeping submission a valid user choice.
 */
export default function ConfirmSubmitDialog({
  submitting,
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-label="Confirm submission">
      <div className="animate-rise w-full max-w-sm rounded-2xl border bg-background p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-warning/10 text-warning">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground">Submit with unresolved issues?</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Your album will be <strong className="text-foreground">submitted successfully</strong> — but it
              <strong className="text-foreground"> cannot be printed</strong> until the remaining issues are resolved.
              You can keep editing anytime before you pay.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" className={LUX_PRIMARY} onClick={onConfirm} disabled={submitting}>
            {submitting ? <InlineLoader /> : null} Submit Anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
