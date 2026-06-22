'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * Smart back navigation (Phase 10E.3). The ONE return-path control across the product.
 *
 * Behavior (never bare router.back()):
 *   1. Previous internal route — if the referrer is a same-origin page that isn't this
 *      one, go back to it (preserves the user's actual trail, incl. scroll position).
 *   2. Parent route — otherwise (deep link, new tab, external referrer) push `href`.
 *   3. Dashboard fallback — callers whose parent is the home pass `href="/dashboard"`.
 *
 * Rendered as a real <button> with an aria-label so it's keyboard- and screen-reader-
 * friendly; styled to match the existing breadcrumb back links (muted → foreground).
 */
export default function BackLink({
  href,
  label,
  className = '',
}: {
  /** The parent route to fall back to when there's no valid internal history. */
  href: string;
  /** Human label, e.g. "Orders" — also drives the aria-label. */
  label: string;
  className?: string;
}) {
  const router = useRouter();

  const onClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      try {
        const ref = document.referrer;
        if (ref) {
          const u = new URL(ref);
          if (u.origin === window.location.origin && u.pathname !== window.location.pathname) {
            router.back();
            return;
          }
        }
      } catch {
        /* malformed referrer → fall through to the explicit parent */
      }
    }
    router.push(href);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Back to ${label}`}
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
