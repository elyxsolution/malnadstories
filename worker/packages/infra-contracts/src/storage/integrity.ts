import type { Result } from '@workerv2/contracts';
import type { IntegrityError } from '../errors.js';
import type { StorageKey } from './artifact-store.js';

/**
 * Verifies that a block of bytes matches an expected content address — the integrity check that
 * makes content-addressing trustworthy (detects corruption or a mis-addressed write). Pure and
 * deterministic: it recomputes the address of `data` and compares it to `expected`.
 */
export interface IntegrityVerifier {
  verify(data: Uint8Array, expected: StorageKey): Result<void, IntegrityError>;
}
