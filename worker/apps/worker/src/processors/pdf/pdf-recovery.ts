import { randomBytes } from 'node:crypto';
import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { JobProducer } from '../../infra/queue/pgboss-queue.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryResult,
} from '../../recovery/recoverable.js';
import type { AlbumPdfStore } from './album-pdf-repository.js';
import { AlbumPdfRepository } from './album-pdf-repository.js';
import { hashToken } from './pdf-contract.js';
import { ALBUM_PDF_TYPE } from './pdf-processor.js';

/**
 * PDF RECOVERY — the `RecoverableProcessor` for album PDFs. It heals the one condition the processor
 * can't self-heal: a row stuck `generating` because the worker crashed / the job expired mid-render
 * ("generating forever", "uploaded but DB incomplete", "browser interruption", "stale rendering" all
 * present the same way — a stale `generating` row).
 *
 * Healing RE-DRIVES with a FRESH token (mint → reset the row to `generating` with a new token +
 * incremented attempt → re-enqueue the album-pdf job). Fresh tokens make re-drive safe under
 * concurrency: the print route only honors the current token, so an older superseded job simply skips.
 * Past the attempt cap the row is ABANDONED (marked `failed`) so it can't loop forever.
 */
export interface PdfRecoveryDeps {
  readonly pdf: AlbumPdfStore;
  readonly producer: JobProducer;
  readonly logger: StructuredLogger;
  /** A `generating` row older than this is considered stuck. MUST exceed a render's worst-case runtime. */
  readonly staleMs: number;
  /** Give up (→ failed) after this many drives for the current request. */
  readonly maxAttempts: number;
  /** Fresh print-token TTL (ms). */
  readonly tokenTtlMs: number;
}

export class PdfRecoverableProcessor implements RecoverableProcessor {
  readonly name = ALBUM_PDF_TYPE;

  constructor(private readonly deps: PdfRecoveryDeps) {}

  async detectStale(limit: number, _token: CancellationToken): Promise<readonly RecoveryItem[]> {
    const cutoff = new Date(Date.now() - this.deps.staleMs);
    const rows = await this.deps.pdf.findStaleGenerating(cutoff, limit);
    return rows.map((r) => ({
      kind: 'stuck-generating',
      id: r.albumId,
      detail: { attempts: r.attempts },
    }));
  }

  async recover(item: RecoveryItem, _token: CancellationToken): Promise<RecoveryResult> {
    // Re-read: a slow render (or a concurrent sweep) may have finished it since detection.
    const state = await this.deps.pdf.findPdfState(item.id);
    if (state === null || state.status !== 'generating') {
      return { outcome: 'already-healed' };
    }

    const attempts = typeof item.detail?.['attempts'] === 'number' ? item.detail['attempts'] : 0;
    if (attempts >= this.deps.maxAttempts) {
      await this.deps.pdf.markFailed(item.id, 'exceeded PDF recovery attempts', 'render_timeout');
      return { outcome: 'abandoned', detail: { attempts } };
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.deps.tokenTtlMs).toISOString();
    await this.deps.pdf.redrive(item.id, hashToken(rawToken), expiresAt, attempts + 1);
    await this.deps.producer.enqueue(ALBUM_PDF_TYPE, { albumId: item.id, token: rawToken });
    return { outcome: 'recovered', detail: { attempt: attempts + 1 } };
  }
}

/** Build the PDF recoverable processor over the DB adapter. */
export function createPdfRecoverableProcessor(deps: {
  database: DatabaseAdapter;
  producer: JobProducer;
  logger: StructuredLogger;
  staleMs: number;
  maxAttempts: number;
  tokenTtlMs: number;
}): PdfRecoverableProcessor {
  return new PdfRecoverableProcessor({
    pdf: new AlbumPdfRepository(deps.database),
    producer: deps.producer,
    logger: deps.logger,
    staleMs: deps.staleMs,
    maxAttempts: deps.maxAttempts,
    tokenTtlMs: deps.tokenTtlMs,
  });
}
