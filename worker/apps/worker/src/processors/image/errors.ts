/**
 * IMAGE PIPELINE ERROR TAXONOMY — the single axis that decides retry vs. reject.
 *
 *   • `PermanentImageError` — the input can never succeed (spoofed/unsupported type, undecodable bytes,
 *     decompression bomb, missing raw key). The processor marks the photo `rejected` and ACKs — retrying
 *     a malformed file is pointless and a retry storm is its own hazard.
 *   • Any OTHER thrown error is treated as TRANSIENT (network blip, R2/DB hiccup, a not-yet-consistent
 *     object). The processor rethrows so the broker retries with backoff. `TransientImageError` is a
 *     named marker for the common "raw object not readable yet" case; plain errors are transient too.
 */

/** Permanent, non-retryable input problem → mark the photo `rejected`, do not retry. */
export class PermanentImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentImageError';
  }
}

/** Transient problem (e.g. raw object not yet readable) → rethrow so the broker retries. */
export class TransientImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientImageError';
  }
}
