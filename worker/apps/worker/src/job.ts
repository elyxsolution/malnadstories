/**
 * THE JOB ENVELOPE — the generic, broker-agnostic unit of work the worker consumes.
 *
 * The runtime's original job shape was `{ id, blueprint }` (album render only). This envelope
 * GENERALIZES that: a typed `type` + opaque `payload` + tracing `metadata` + timestamps, so a single
 * consume loop can carry ANY future job (`image-hardening`, `album-pdf`, `r2-cleanup`, …) without the
 * runtime or the app loop changing again. It carries NO handler logic — routing (see `router.ts`) maps
 * a `type` to a handler; this module defines only the data contract.
 *
 * The payload is intentionally `unknown` at this layer: the queue adapter deserializes broker bytes
 * into a `Job<unknown>`, and the (future) per-type handler is the ONLY place that narrows the payload
 * to its concrete shape. Nothing here knows about photos, albums, PDFs, or storage.
 */

/**
 * The job's discriminator. An open string vocabulary on purpose — new job types are added by
 * registering a handler for a new `type`, never by editing this file. The production values map
 * 1:1 to the broker queue names (`image-hardening`, `album-pdf`, `r2-cleanup`, …).
 */
export type JobType = string;

/** Tracing/operational metadata that travels with every job. Never carries secrets. */
export interface JobMetadata {
  /**
   * Correlation id linking this unit of work across the app (enqueue) and the worker (execution) —
   * the same identifier the app mints as `x-request-id`. Falls back to the broker job id when the
   * producer supplied none.
   */
  readonly correlationId: string;
  /** 1-based delivery attempt, derived from the broker's retry count (first delivery = 1). */
  readonly attempt: number;
  /** Optional free-form tags for tracing/debugging (never secrets, never PII). */
  readonly tags?: Readonly<Record<string, string>>;
}

/**
 * One unit of work. `TPayload` defaults to `unknown` so the transport layer stays type-agnostic; a
 * concrete handler narrows it. Immutable by contract (`readonly`) — a job is a value, not a mutable
 * record.
 */
export interface Job<TPayload = unknown> {
  /** The broker's unique job id (used for ack/nack). */
  readonly id: string;
  /** The job type discriminator (== broker queue name in production). */
  readonly type: JobType;
  /** The opaque, handler-narrowed work payload. */
  readonly payload: TPayload;
  /** Tracing/operational metadata. */
  readonly metadata: JobMetadata;
  /** ISO-8601 time the job was enqueued (broker-provided when available, else receipt time). */
  readonly enqueuedAt: string;
  /** ISO-8601 time the worker received the job off the broker. */
  readonly receivedAt: string;
}
