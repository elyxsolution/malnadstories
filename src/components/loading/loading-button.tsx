'use client';

import { useRef, useState, type ComponentProps, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from './malnad-loader';
import { useDelayedLoading } from './use-delayed-loading';
import { resolveStaticMessage, type MessageGroup } from './loading-config';

/**
 * LoadingButton — a Button that shows the ONE loading animation while an async action runs.
 *
 * Two modes (composable):
 *  • Auto: pass an async `onClick`; the button enters its busy state while the returned promise
 *    is pending, then restores automatically.
 *  • Controlled: pass `loading` (e.g. from useFormStatus / a parent state).
 *
 * Guarantees: prevents double-submit (in-flight ref + disabled), disables while loading, and
 * exposes aria-busy. Restores itself in `finally` so an error never leaves it stuck.
 */
type ButtonProps = ComponentProps<typeof Button>;

export function LoadingButton({
  onClick,
  loading,
  loadingText,
  messageGroup,
  children,
  disabled,
  ...rest
}: ButtonProps & {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  loading?: boolean;
  /** Busy-state label; else derived from `messageGroup` (its first line). */
  loadingText?: string;
  messageGroup?: MessageGroup;
}) {
  const busyLabel = loadingText ?? (messageGroup ? resolveStaticMessage({ messageGroup }) : undefined);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const isLoading = loading ?? busy;
  // Disable immediately (double-submit safe) but only SHOW the loader after the delay + keep it
  // for the minimum duration — so a sub-300ms action never flashes the inline loader.
  const { mounted: showLoader } = useDelayedLoading(isLoading);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inFlight.current || isLoading) {
      e.preventDefault();
      return;
    }
    const result = onClick?.(e);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      inFlight.current = true;
      setBusy(true);
      void (result as Promise<unknown>).finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
    }
  };

  return (
    <Button {...rest} disabled={disabled || isLoading} aria-busy={isLoading} onClick={handleClick}>
      {showLoader && <InlineLoader size={18} />}
      {showLoader && busyLabel ? busyLabel : children}
    </Button>
  );
}
