import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { IntegrityError } from '@workerv2/infra-contracts';
import type { IntegrityVerifier, StorageKey } from '@workerv2/infra-contracts';
import { Sha256ContentAddressing } from './content-addressing.js';

/**
 * Content-integrity verification: recompute the content address of `data` and compare it to the
 * expected key. Pure and deterministic — a mismatch means the bytes are corrupt or were written
 * under the wrong identity. Never mutates, never reads ambient state.
 */
export class Sha256IntegrityVerifier implements IntegrityVerifier {
  private readonly addressing = new Sha256ContentAddressing();

  verify(data: Uint8Array, expected: StorageKey): Result<void, IntegrityError> {
    const actual = this.addressing.address(data);
    if (actual !== expected) {
      return err(
        new IntegrityError('Content does not match its content address', {
          context: { expected, actual, sizeBytes: data.byteLength },
        }),
      );
    }
    return ok(undefined);
  }
}
