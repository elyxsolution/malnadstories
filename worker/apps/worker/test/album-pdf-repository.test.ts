import { describe, it, expect } from 'vitest';
import type {
  DatabaseAdapter,
  DatabaseTransaction,
} from '../src/infra/database/database-adapter.js';
import { AlbumPdfRepository } from '../src/processors/pdf/album-pdf-repository.js';

class RecordingDb implements DatabaseAdapter {
  readonly calls: Array<{ text: string; params: readonly unknown[] }> = [];
  rows: readonly unknown[] = [];
  async connect(): Promise<void> {}
  async query<T>(text: string, params?: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ text, params: params ?? [] });
    return this.rows as readonly T[];
  }
  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return fn({ query: (t, p) => this.query(t, p) });
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
  async close(): Promise<void> {}
}

describe('AlbumPdfRepository', () => {
  it('findAlbumOwner maps user_id, or null', async () => {
    const db = new RecordingDb();
    db.rows = [{ user_id: 'u1' }];
    const repo = new AlbumPdfRepository(db);
    expect(await repo.findAlbumOwner('a1')).toEqual({ userId: 'u1' });
    expect(db.calls[0]?.params).toEqual(['a1']);
    db.rows = [];
    expect(await repo.findAlbumOwner('missing')).toBeNull();
  });

  it('findPdfState maps status/token columns', async () => {
    const db = new RecordingDb();
    db.rows = [
      { status: 'generating', token_hash: 'abc', token_expires_at: '2026-01-01T00:00:00Z' },
    ];
    expect(await new AlbumPdfRepository(db).findPdfState('a1', 'preview')).toEqual({
      status: 'generating',
      tokenHash: 'abc',
      tokenExpiresAt: '2026-01-01T00:00:00Z',
    });
    // Kind-scoped (0058): the row is selected by (album_id, kind), never album_id alone.
    expect(db.calls[0]?.text).toContain('kind = $2');
    expect(db.calls[0]?.params).toEqual(['a1', 'preview']);
  });

  it('setStage is gated to a still-generating row', async () => {
    const db = new RecordingDb();
    await new AlbumPdfRepository(db).setStage('a1', 'preview', 'rendering');
    expect(db.calls[0]?.text).toContain("status = 'generating'");
    expect(db.calls[0]?.params).toEqual(['a1', 'preview', 'rendering']);
  });

  it('markReady points the row at the PDF (status ready, generated_at set)', async () => {
    const db = new RecordingDb();
    await new AlbumPdfRepository(db).markReady('a1', 'preview', 'u1/albums/a1/preview.pdf');
    const call = db.calls[0]!;
    expect(call.text).toContain("status = 'ready'");
    expect(call.text).toContain('generated_at = now()');
    expect(call.params).toEqual(['a1', 'preview', 'u1/albums/a1/preview.pdf']);
  });

  it('markFailed records the message (truncated) + typed code', async () => {
    const db = new RecordingDb();
    await new AlbumPdfRepository(db).markFailed('a1', 'preview', 'x'.repeat(600), 'render_timeout');
    const call = db.calls[0]!;
    expect(call.text).toContain("status = 'failed'");
    expect(call.params[0]).toBe('a1');
    expect(call.params[1]).toBe('preview');
    expect((call.params[2] as string).length).toBe(500); // truncated
    expect(call.params[3]).toBe('render_timeout');
  });

  // ── 0058: every write is scoped to ONE artifact ───────────────────────────────────────────
  describe('kind scoping (0058)', () => {
    it('a print_content failure targets only that row — never the preview', async () => {
      const db = new RecordingDb();
      await new AlbumPdfRepository(db).markFailed('a1', 'print_content', 'boom', 'render_failed');
      const call = db.calls[0]!;
      expect(call.text).toContain('kind = $2');
      expect(call.params[1]).toBe('print_content');
    });

    it('markReady writes the artifact it rendered, not the album', async () => {
      const db = new RecordingDb();
      await new AlbumPdfRepository(db).markReady('a1', 'print_cover', 'u1/albums/a1/print-cover.pdf');
      expect(db.calls[0]!.text).toContain('kind = $2');
      expect(db.calls[0]!.params).toEqual(['a1', 'print_cover', 'u1/albums/a1/print-cover.pdf']);
    });

    it('findStaleGenerating reports each stuck row WITH its kind', async () => {
      const db = new RecordingDb();
      db.rows = [
        { album_id: 'a1', kind: 'print_cover', attempts: 2 },
        { album_id: 'a1', kind: 'preview', attempts: 0 },
      ];
      const stale = await new AlbumPdfRepository(db).findStaleGenerating(new Date(0), 10);
      expect(stale).toEqual([
        { albumId: 'a1', kind: 'print_cover', attempts: 2 },
        { albumId: 'a1', kind: 'preview', attempts: 0 },
      ]);
    });

    it('a row with no kind (pre-0058) is treated as the preview', async () => {
      const db = new RecordingDb();
      db.rows = [{ album_id: 'a1', kind: null, attempts: 1 }];
      const stale = await new AlbumPdfRepository(db).findStaleGenerating(new Date(0), 10);
      expect(stale[0]!.kind).toBe('preview');
    });

    it('redrive rotates the token of one artifact only', async () => {
      const db = new RecordingDb();
      await new AlbumPdfRepository(db).redrive('a1', 'print_content', 'hash', '2026-01-01T00:00:00Z', 3);
      const call = db.calls[0]!;
      expect(call.text).toContain('kind = $2');
      expect(call.text).toContain("status = 'generating'");
      expect(call.params).toEqual(['a1', 'print_content', 'hash', '2026-01-01T00:00:00Z', 3]);
    });
  });
});
