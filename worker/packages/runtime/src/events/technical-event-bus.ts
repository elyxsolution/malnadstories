import type { TechnicalEvent } from '@workerv2/control-plane';

/** A synchronous subscriber to technical events. Listeners must not throw. */
export type TechnicalEventListener = (event: TechnicalEvent) => void;

/**
 * A minimal synchronous, in-memory pub/sub bus for TECHNICAL events (INV-12 — the operational
 * stream, separate from domain events). A misbehaving listener is isolated so it cannot break
 * publication or other listeners; the failed listener count is returned for the caller to
 * observe. No I/O, no async, no ordering surprises.
 */
export class TechnicalEventBus {
  private readonly listeners = new Set<TechnicalEventListener>();

  /** Subscribe; returns an unsubscribe function. */
  subscribe(listener: TechnicalEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Publish to all current listeners. Returns the number of listeners that threw (isolated). */
  publish(event: TechnicalEvent): number {
    let failures = 0;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        failures += 1;
      }
    }
    return failures;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
