/**
 * THE DELETION PRIMITIVE — the one place in this codebase's cleanup path that can destroy an
 * object, and the narrowest surface it was possible to give it.
 *
 * THE SIGNATURE IS THE SAFETY. `deleteVerified(orphan: VerifiedOrphan)` cannot be called with a
 * string, a prefix, a pattern, or a hand-built object: `VerifiedOrphan` carries a `unique symbol`
 * brand that only `verify.ts` can attach, and only after every fresh gate has passed. There is no
 * `deleteObject(key)` and no `deleteByPrefix` — those are not functions this module declines to
 * export, they are functions that do not exist.
 *
 * EXACT KEY ONLY. `DeleteObjectCommand` is issued against `orphan.key` verbatim. `DeleteObjects`
 * (the batch API) is deliberately NOT used: it accepts a key list, which is precisely the shape
 * that makes a mistake cheap, and per-key deletion gives an unambiguous per-key result. At the
 * volumes involved (hundreds of objects, run manually) the throughput difference is irrelevant
 * and the clarity is not.
 *
 * POST-DELETE VERIFICATION. A `DeleteObject` that returns without throwing is not proof: the
 * caller re-heads the key and only then reports success.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { VerifiedOrphan } from './model.js';

/** The minimal S3 surface (injectable/fakeable, mirroring the read-only lister's `S3ListLike`). */
export interface S3DeleteLike {
  send(command: unknown): Promise<unknown>;
}

export interface DeleterConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/**
 * The capability an executing cleanup run holds. A dry run holds NO value of this type at all —
 * see `executor.ts`, where the dry-run variant of the union simply has no `deleter` field.
 */
export interface VerifiedOrphanDeleter {
  /** Delete one proven-orphaned object. The parameter type is the authorisation. */
  deleteVerified(orphan: VerifiedOrphan): Promise<void>;
}

export class R2VerifiedOrphanDeleter implements VerifiedOrphanDeleter {
  constructor(
    private readonly client: S3DeleteLike,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: DeleterConfig): R2VerifiedOrphanDeleter {
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    return new R2VerifiedOrphanDeleter(client as unknown as S3DeleteLike, config.bucket);
  }

  /**
   * Issue exactly one `DeleteObject` for exactly one key. Errors propagate: the caller classifies
   * them as `DELETE_FAILED` and moves on to the next INDEPENDENTLY verified candidate. There is
   * no retry loop here — a transient failure must not become repeated destructive attempts.
   */
  async deleteVerified(orphan: VerifiedOrphan): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: orphan.key }));
  }
}
