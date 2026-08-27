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
import { DEFAULT_PDF_KIND, hashToken, isPdfKind } from './pdf-contract.js';
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
    // NOTE: `RecoveryItem.kind` is the RECOVERY vocabulary ("what is wrong"), not the PDF kind.
    // The PDF kind rides in `detail.pdfKind` so one album's stuck print export is re-driven as a
    // print export — never as its preview, and never overwriting the other artifact's row.
    return rows.map((r) => ({
      kind: 'stuck-generating',
      id: recoveryId(r.albumId, r.kind),
      detail: { attempts: r.attempts, albumId: r.albumId, pdfKind: r.kind },
    }));
  }

  async recover(item: RecoveryItem, _token: CancellationToken): Promise<RecoveryResult> {
    const albumId = typeof item.detail?.['albumId'] === 'string' ? item.detail['albumId'] : item.id;
    const rawKind = item.detail?.['pdfKind'];
    const pdfKind = isPdfKind(rawKind) ? rawKind : DEFAULT_PDF_KIND;

    // Re-read: a slow render (or a concurrent sweep) may have finished it since detection.
    const state = await this.deps.pdf.findPdfState(albumId, pdfKind);
    if (state === null || state.status !== 'generating') {
      return { outcome: 'already-healed' };
    }

    const attempts = typeof item.detail?.['attempts'] === 'number' ? item.detail['attempts'] : 0;
    if (attempts >= this.deps.maxAttempts) {
      await this.deps.pdf.markFailed(
        albumId,
        pdfKind,
        'exceeded PDF recovery attempts',
        'render_timeout',
      );
      return { outcome: 'abandoned', detail: { attempts, pdfKind } };
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.deps.tokenTtlMs).toISOString();
    await this.deps.pdf.redrive(albumId, pdfKind, hashToken(rawToken), expiresAt, attempts + 1);
    await this.deps.producer.enqueue(ALBUM_PDF_TYPE, { albumId, token: rawToken, kind: pdfKind });
    return { outcome: 'recovered', detail: { attempt: attempts + 1, pdfKind } };
  }
}

/**
 * The recovery item's id. It must be UNIQUE PER ARTIFACT (0058), because the coordinator dedupes
 * and reports by id: with three kinds per album, a bare album id would let one stuck artifact mask
 * another's, and only one of them would ever be healed. The preview keeps the bare album id so its
 * recovery identity — and anything an operator has seen in a log — is unchanged.
 */
function recoveryId(albumId: string, pdfKind: string): string {
  return pdfKind === DEFAULT_PDF_KIND ? albumId : `${albumId}:${pdfKind}`;
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
