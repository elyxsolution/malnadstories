import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import { PdfRecoverableProcessor } from '../src/processors/pdf/pdf-recovery.js';
import type {
  AlbumOwner,
  AlbumPdfStore,
  PdfState,
  StaleGeneration,
} from '../src/processors/pdf/album-pdf-repository.js';
import type { PdfFailureCode, PdfKind, PdfStage } from '../src/processors/pdf/pdf-contract.js';
import type { JobProducer } from '../src/infra/queue/pgboss-queue.js';
import { NONE } from '../src/recovery/cancellation.js';

class FakePdfStore implements AlbumPdfStore {
  state: PdfState | null = { status: 'generating', tokenHash: 'old', tokenExpiresAt: null };
  stale: StaleGeneration[] = [];
  redriven: Array<{ albumId: string; kind: PdfKind; tokenHash: string; attempts: number }> = [];
  failed: { albumId: string; kind: PdfKind; code: PdfFailureCode } | null = null;
  /** Every (album, kind) pair the recovery asked about — proves it re-reads the right row. */
  readonly stateQueries: Array<{ albumId: string; kind: PdfKind }> = [];

  async findAlbumOwner(): Promise<AlbumOwner | null> {
    return { userId: 'u1' };
  }
  async findPdfState(albumId: string, kind: PdfKind): Promise<PdfState | null> {
    this.stateQueries.push({ albumId, kind });
    return this.state;
  }
  async setStage(_a: string, _k: PdfKind, _s: PdfStage): Promise<void> {}
  async markReady(): Promise<boolean> {
    return true;
  }
  async markFailed(albumId: string, kind: PdfKind, _m: string, code: PdfFailureCode): Promise<void> {
    this.failed = { albumId, kind, code };
  }
  async findStaleGenerating(): Promise<readonly StaleGeneration[]> {
    return this.stale;
  }
  async redrive(
    albumId: string,
    kind: PdfKind,
    tokenHash: string,
    _e: string,
    attempts: number,
  ): Promise<void> {
    this.redriven.push({ albumId, kind, tokenHash, attempts });
  }
}

class FakeProducer implements JobProducer {
  readonly sent: Array<{ queue: string; payload: object }> = [];
  async enqueue(queue: string, payload: object): Promise<void> {
    this.sent.push({ queue, payload });
  }
}

function build(): { proc: PdfRecoverableProcessor; pdf: FakePdfStore; producer: FakeProducer } {
  const pdf = new FakePdfStore();
  const producer = new FakeProducer();
  const proc = new PdfRecoverableProcessor({
    pdf,
    producer,
    logger: new RecordingLogger(),
    staleMs: 7 * 60 * 1000,
    maxAttempts: 5,
    tokenTtlMs: 5 * 60 * 1000,
  });
  return { proc, pdf, producer };
}

describe('PdfRecoverableProcessor', () => {
  it('detects stuck-generating rows with their attempt count', async () => {
    const { proc, pdf } = build();
    pdf.stale = [{ albumId: 'a1', kind: 'preview', attempts: 2 }];
    const items = await proc.detectStale(100, NONE);
    expect(items).toEqual([
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 2, albumId: 'a1', pdfKind: 'preview' } },
    ]);
  });

  it('re-drives a stuck generation with a FRESH token + bumped attempt (recovered)', async () => {
    const { proc, pdf, producer } = build();
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 2, albumId: 'a1', pdfKind: 'preview' } },
      NONE,
    );
    expect(result.outcome).toBe('recovered');
    expect(pdf.redriven).toHaveLength(1);
    expect(pdf.redriven[0]).toMatchObject({ albumId: 'a1', kind: 'preview', attempts: 3 });
    // a fresh RAW token rides in the job payload; only its hash is stored
    expect(producer.sent).toHaveLength(1);
    const payload = producer.sent[0]!.payload as { albumId: string; token: string; kind: PdfKind };
    expect(payload.albumId).toBe('a1');
    expect(payload.kind).toBe('preview');
    expect(payload.token).toHaveLength(64); // randomBytes(32).hex
    expect(pdf.redriven[0]!.tokenHash).not.toBe('old');
  });

  it('abandons a generation past the attempt cap (marked failed)', async () => {
    const { proc, pdf, producer } = build();
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 5, albumId: 'a1', pdfKind: 'preview' } },
      NONE,
    );
    expect(result.outcome).toBe('abandoned');
    expect(pdf.failed).toEqual({ albumId: 'a1', kind: 'preview', code: 'render_timeout' });
    expect(producer.sent).toEqual([]); // not re-driven
  });

  it('is a no-op when the row already left generating (idempotent, race-safe)', async () => {
    const { proc, pdf, producer } = build();
    pdf.state = { status: 'ready', tokenHash: 'x', tokenExpiresAt: null };
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 1, albumId: 'a1', pdfKind: 'preview' } },
      NONE,
    );
    expect(result.outcome).toBe('already-healed');
    expect(pdf.redriven).toEqual([]);
    expect(producer.sent).toEqual([]);
  });

  // ── 0058: the three artifacts recover INDEPENDENTLY ───────────────────────────────────────
  describe('per-artifact recovery (0058)', () => {
    it('gives each stuck artifact of one album its own recovery item', async () => {
      const { proc, pdf } = build();
      pdf.stale = [
        { albumId: 'a1', kind: 'preview', attempts: 0 },
        { albumId: 'a1', kind: 'print_cover', attempts: 1 },
        { albumId: 'a1', kind: 'print_content', attempts: 2 },
      ];
      const items = await proc.detectStale(100, NONE);
      // Ids MUST be distinct, or the coordinator dedupes two real problems into one and only one
      // of them is ever healed. The preview keeps the bare album id it always had.
      expect(items.map((i) => i.id)).toEqual(['a1', 'a1:print_cover', 'a1:print_content']);
      expect(new Set(items.map((i) => i.id)).size).toBe(3);
    });

    it('re-drives a stuck print_content as print_content — not as the preview', async () => {
      const { proc, pdf, producer } = build();
      const result = await proc.recover(
        {
          kind: 'stuck-generating',
          id: 'a1:print_content',
          detail: { attempts: 1, albumId: 'a1', pdfKind: 'print_content' },
        },
        NONE,
      );
      expect(result.outcome).toBe('recovered');
      // It re-read the print_content row, rotated the print_content token, and enqueued a
      // print_content job. Nothing it did could touch the preview of that album.
      expect(pdf.stateQueries).toEqual([{ albumId: 'a1', kind: 'print_content' }]);
      expect(pdf.redriven[0]).toMatchObject({ albumId: 'a1', kind: 'print_content', attempts: 2 });
      expect(producer.sent[0]!.payload).toMatchObject({ albumId: 'a1', kind: 'print_content' });
    });

    it('abandoning a print_cover marks only that artifact failed', async () => {
      const { proc, pdf } = build();
      await proc.recover(
        {
          kind: 'stuck-generating',
          id: 'a1:print_cover',
          detail: { attempts: 5, albumId: 'a1', pdfKind: 'print_cover' },
        },
        NONE,
      );
      expect(pdf.failed).toEqual({ albumId: 'a1', kind: 'print_cover', code: 'render_timeout' });
    });

    it('an item with no pdfKind (pre-0058 in-flight state) recovers as the preview', async () => {
      const { proc, pdf } = build();
      await proc.recover({ kind: 'stuck-generating', id: 'a1', detail: { attempts: 0 } }, NONE);
      expect(pdf.stateQueries).toEqual([{ albumId: 'a1', kind: 'preview' }]);
      expect(pdf.redriven[0]).toMatchObject({ albumId: 'a1', kind: 'preview' });
    });
  });
});
