'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { resolveError } from '@/lib/actions/admin/observability';

/** Single mutation on the Error Center: mark an error resolved (observability:manage). */
export default function ResolveButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async () => {
    setBusy(true);
    setError(null);
    const res = await resolveError({ id });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={resolve}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 active:scale-[0.97]"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Mark resolved
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
