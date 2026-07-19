'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { PencilRuler } from 'lucide-react';
import { markRevisionInProgress } from '@/lib/actions/reviews';

/**
 * "Open Builder" for a changes-requested review. Marks the active revision in_progress
 * (best-effort, advisory) then navigates to the builder where the customer edits and
 * resubmits. Navigation is never blocked by the signal.
 */
export default function OpenBuilderButton({ albumId }: { albumId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      await markRevisionInProgress({ albumId });
    } catch {
      // advisory only — proceed regardless
    }
    router.push(`/albums/${albumId}/build`);
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? <InlineLoader /> : <PencilRuler className="h-4 w-4" />}
      Open builder to make changes
    </button>
  );
}
