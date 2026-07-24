import type { CancellationToken } from './cancellation.js';

/**
 * THE RECOVERABLE PROCESSOR CONTRACT — the generic hook a processor implements to become self-healing.
 * A processor stays focused on executing ONE job; its recovery counterpart answers two questions for the
 * Recovery Coordinator: "what work is stale?" (`detectStale`) and "heal this one item" (`recover`). The
 * Coordinator owns scheduling, batching, events, and metrics; the processor owns only its domain's
 * detection + repair. New processors become recoverable simply by implementing this interface — no
 * coordinator change.
 *
 * BOTH methods must be IDEMPOTENT and BOUNDED: `detectStale` returns at most `limit` items (no full
 * scans); `recover` can be called repeatedly on the same item without harm (already-healed → a no-op
 * outcome). Both observe the `CancellationToken` so a sweep aborts promptly on shutdown.
 */

/** One unit of stale work to heal. `kind` distinguishes conditions within a processor (e.g. `stale-pending`). */
export interface RecoveryItem {
  readonly kind: string;
  readonly id: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * The result of attempting to heal one item:
 *   • `recovered`      — the item was re-driven / reconciled / repaired.
 *   • `abandoned`      — permanently unrecoverable (e.g. attempt cap hit) → marked terminal.
 *   • `already-healed` — a concurrent actor already fixed it (idempotent no-op).
 *   • `skipped`        — not eligible this pass (e.g. still within its live window).
 */
export type RecoveryOutcome = 'recovered' | 'abandoned' | 'already-healed' | 'skipped';

export interface RecoveryResult {
  readonly outcome: RecoveryOutcome;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RecoverableProcessor {
  /** Stable name (matches the processor / job type, e.g. `image-hardening`, `album-pdf`). */
  readonly name: string;
  /** Find up to `limit` stale items (bounded query; newest-safe). */
  detectStale(limit: number, token: CancellationToken): Promise<readonly RecoveryItem[]>;
  /** Heal one item. Must be idempotent + safe to run concurrently with live processing. */
  recover(item: RecoveryItem, token: CancellationToken): Promise<RecoveryResult>;
}
