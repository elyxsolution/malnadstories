import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import { PdfRecoverableProcessor } from '../src/processors/pdf/pdf-recovery.js';
import type {
  AlbumOwner,
  AlbumPdfStore,
  PdfState,
  StaleGeneration,
} from '../src/processors/pdf/album-pdf-repository.js';
import type { PdfFailureCode, PdfStage } from '../src/processors/pdf/pdf-contract.js';
import type { JobProducer } from '../src/infra/queue/pgboss-queue.js';
import { NONE } from '../src/recovery/cancellation.js';

class FakePdfStore implements AlbumPdfStore {
  state: PdfState | null = { status: 'generating', tokenHash: 'old', tokenExpiresAt: null };
  stale: StaleGeneration[] = [];
  redriven: Array<{ albumId: string; tokenHash: string; attempts: number }> = [];
  failed: { albumId: string; code: PdfFailureCode } | null = null;

  async findAlbumOwner(): Promise<AlbumOwner | null> {
    return { userId: 'u1' };
  }
  async findPdfState(): Promise<PdfState | null> {
    return this.state;
  }
  async setStage(_a: string, _s: PdfStage): Promise<void> {}
  async markReady(): Promise<void> {}
  async markFailed(albumId: string, _m: string, code: PdfFailureCode): Promise<void> {
    this.failed = { albumId, code };
  }
  async findStaleGenerating(): Promise<readonly StaleGeneration[]> {
    return this.stale;
  }
  async redrive(albumId: string, tokenHash: string, _e: string, attempts: number): Promise<void> {
    this.redriven.push({ albumId, tokenHash, attempts });
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
    pdf.stale = [{ albumId: 'a1', attempts: 2 }];
    const items = await proc.detectStale(100, NONE);
    expect(items).toEqual([{ kind: 'stuck-generating', id: 'a1', detail: { attempts: 2 } }]);
  });

  it('re-drives a stuck generation with a FRESH token + bumped attempt (recovered)', async () => {
    const { proc, pdf, producer } = build();
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 2 } },
      NONE,
    );
    expect(result.outcome).toBe('recovered');
    expect(pdf.redriven).toHaveLength(1);
    expect(pdf.redriven[0]).toMatchObject({ albumId: 'a1', attempts: 3 });
    // a fresh RAW token rides in the job payload; only its hash is stored
    expect(producer.sent).toHaveLength(1);
    const payload = producer.sent[0]!.payload as { albumId: string; token: string };
    expect(payload.albumId).toBe('a1');
    expect(payload.token).toHaveLength(64); // randomBytes(32).hex
    expect(pdf.redriven[0]!.tokenHash).not.toBe('old');
  });

  it('abandons a generation past the attempt cap (marked failed)', async () => {
    const { proc, pdf, producer } = build();
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 5 } },
      NONE,
    );
    expect(result.outcome).toBe('abandoned');
    expect(pdf.failed).toEqual({ albumId: 'a1', code: 'render_timeout' });
    expect(producer.sent).toEqual([]); // not re-driven
  });

  it('is a no-op when the row already left generating (idempotent, race-safe)', async () => {
    const { proc, pdf, producer } = build();
    pdf.state = { status: 'ready', tokenHash: 'x', tokenExpiresAt: null };
    const result = await proc.recover(
      { kind: 'stuck-generating', id: 'a1', detail: { attempts: 1 } },
      NONE,
    );
    expect(result.outcome).toBe('already-healed');
    expect(pdf.redriven).toEqual([]);
    expect(producer.sent).toEqual([]);
  });
});
