/**
 * THE PREVIEW-PDF DELETION BOUNDARY — the same two ideas that protect the raw-upload path.
 *
 * 1. DRY RUN CARRIES NO CAPABILITY. `dry-run` is a variant of a discriminated union that has no
 *    `deleter` field at all, so `executor.deleter` in that branch is a compile error, not a
 *    runtime `undefined`. The dry-run path constructs no S3 client with delete permission.
 *
 * 2. THE SIGNATURE IS THE AUTHORISATION. `deletePreviewVerified(orphan: VerifiedPreviewOrphan)`
 *    cannot be called with a string, a prefix, or a hand-built object — the brand is a `unique
 *    symbol` that only `reclaim.ts` can attach, and only after every fresh gate has passed. There
 *    is no `deleteObject(key)` and no `deleteByPrefix` in this module; they do not exist.
 *
 * `DeleteObjects` (the batch API) is deliberately not used: it takes a key list, which is exactly
 * the shape that makes a mistake cheap.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { VerifiedPreviewOrphan } from './model.js';

/** The minimal S3 surface (injectable/fakeable). */
export interface S3DeleteLike {
  send(command: unknown): Promise<unknown>;
}

export interface PreviewDeleterConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** The capability an executing run holds. A dry run holds no value of this type at all. */
export interface VerifiedPreviewDeleter {
  deletePreviewVerified(orphan: VerifiedPreviewOrphan): Promise<void>;
}

export class R2VerifiedPreviewDeleter implements VerifiedPreviewDeleter {
  constructor(
    private readonly client: S3DeleteLike,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: PreviewDeleterConfig): R2VerifiedPreviewDeleter {
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    return new R2VerifiedPreviewDeleter(client as unknown as S3DeleteLike, config.bucket);
  }

  /** Exactly one `DeleteObject` for exactly one key. Errors propagate; there is no retry loop. */
  async deletePreviewVerified(orphan: VerifiedPreviewOrphan): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: orphan.key }));
  }
}

export type PreviewExecutor =
  | { readonly mode: 'dry-run' }
  | { readonly mode: 'execute'; readonly deleter: VerifiedPreviewDeleter };

/** A dry-run executor. Carries no capability whatsoever. */
export function previewDryRunExecutor(): PreviewExecutor {
  return { mode: 'dry-run' };
}

/** An executing executor. The ONLY way a deleter enters the pipeline. */
export function previewExecutingExecutor(deleter: VerifiedPreviewDeleter): PreviewExecutor {
  return { mode: 'execute', deleter };
}
