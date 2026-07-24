/**
 * COOPERATIVE CANCELLATION — a generic, dependency-free token long-running work observes to abort
 * promptly (e.g. on graceful shutdown). It is COOPERATIVE: the holder periodically calls
 * `throwIfCancelled()` (or checks `cancelled`) at safe points; nothing is force-killed. A
 * `CancellationSource` owns the trigger; consumers receive only the read-only `token`. `NONE` is the
 * never-cancelled token for callers that don't participate.
 */

export class CancellationError extends Error {
  constructor(message = 'operation cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

export interface CancellationToken {
  /** Whether cancellation has been requested. */
  readonly cancelled: boolean;
  /** Throw `CancellationError` if cancellation has been requested (a cancellation point). */
  throwIfCancelled(): void;
  /** Register a callback fired once on cancellation (immediately if already cancelled). */
  onCancel(callback: () => void): void;
}

/** The never-cancelled token. */
export const NONE: CancellationToken = {
  cancelled: false,
  throwIfCancelled(): void {
    /* never cancels */
  },
  onCancel(): void {
    /* never cancels */
  },
};

/** Owns the cancellation trigger; hand `.token` to consumers. */
export class CancellationSource {
  private flag = false;
  private readonly callbacks = new Set<() => void>();
  readonly token: CancellationToken;

  constructor() {
    // Arrow closures capture the source instance without aliasing `this` to a variable.
    const isCancelled = (): boolean => this.flag;
    const throwIf = (): void => {
      if (this.flag) throw new CancellationError();
    };
    const register = (callback: () => void): void => {
      if (this.flag) callback();
      else this.callbacks.add(callback);
    };
    this.token = {
      get cancelled(): boolean {
        return isCancelled();
      },
      throwIfCancelled: throwIf,
      onCancel: register,
    };
  }

  /** Request cancellation (idempotent); fires registered callbacks once. */
  cancel(): void {
    if (this.flag) return;
    this.flag = true;
    for (const callback of this.callbacks) {
      try {
        callback();
      } catch {
        /* a cancellation callback must never break cancellation */
      }
    }
    this.callbacks.clear();
  }
}
