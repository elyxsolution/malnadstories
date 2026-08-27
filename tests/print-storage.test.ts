/**
 * PRINT ARTIFACT STORAGE (0058) — three artifacts per album, each fully independent.
 *
 * `album_pdfs` used to be keyed by `album_id` alone: one album, one PDF. The printer-ready exports
 * make that three, and the whole value of the change is that they cannot interfere with one
 * another — a failed print export must never reset a preview a customer can already download, and
 * two exports must never share an R2 object.
 *
 * Also pins the RECLAIMABILITY contract. A generated PDF that no database row can name after the
 * album cascade is gone forever: the orphan scanner deliberately excludes album PDFs from its
 * raw-upload candidate set, so `deleteAlbum` reconstructing the deterministic key is the ONLY
 * mechanism that can ever collect one.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PDF_KIND,
  PDF_KINDS,
  PDF_KIND_FILENAME,
  PDF_KIND_LABEL,
  PRINT_PDF_KINDS,
  isPdfKind,
  toPdfKind,
  type PdfKind,
} from '@/lib/pdf/kind';
import {
  ALBUM_PDF_BASENAMES,
  albumPdfKey,
  previewPdfKey,
  printContentPdfKey,
  printCoverPdfKey,
} from '@/lib/pdf/key';

const USER = '11111111-1111-4111-8111-111111111111';
const ALBUM = '22222222-2222-4222-8222-222222222222';

describe('the kind vocabulary', () => {
  it('is exactly preview + the two printer-ready exports', () => {
    expect(PDF_KINDS).toEqual(['preview', 'print_cover', 'print_content']);
  });

  it('defaults to preview — every pre-0058 row and caller means the customer artifact', () => {
    expect(DEFAULT_PDF_KIND).toBe('preview');
    expect(toPdfKind(undefined)).toBe('preview');
    expect(toPdfKind(null)).toBe('preview');
    expect(toPdfKind('')).toBe('preview');
    expect(toPdfKind('nonsense')).toBe('preview');
  });

  it('never coerces one valid kind into another', () => {
    for (const k of PDF_KINDS) expect(toPdfKind(k)).toBe(k);
  });

  it('rejects anything outside the vocabulary', () => {
    for (const bad of ['Preview', 'print-cover', 'cover', 42, {}, [], null, undefined]) {
      expect(isPdfKind(bad)).toBe(false);
    }
  });

  it('treats the PRINT kinds as a strict subset that excludes the preview', () => {
    // The admin print action validates against this set, so a caller cannot drive the customer
    // artifact through the printer-ready controls.
    expect(PRINT_PDF_KINDS).toEqual(['print_cover', 'print_content']);
    expect(PRINT_PDF_KINDS as readonly string[]).not.toContain('preview');
  });

  it('names and file-names every kind distinctly', () => {
    const labels = PDF_KINDS.map((k) => PDF_KIND_LABEL[k]);
    const files = PDF_KINDS.map((k) => PDF_KIND_FILENAME[k]);
    expect(new Set(labels).size).toBe(PDF_KINDS.length);
    expect(new Set(files).size).toBe(PDF_KINDS.length);
    expect(files).toEqual(['album-preview.pdf', 'print-cover.pdf', 'print-content.pdf']);
  });
});

describe('R2 keys — one deterministic object per (user, album, kind)', () => {
  it('gives each kind its own key', () => {
    expect(previewPdfKey(USER, ALBUM)).toBe(`${USER}/albums/${ALBUM}/preview.pdf`);
    expect(printCoverPdfKey(USER, ALBUM)).toBe(`${USER}/albums/${ALBUM}/print-cover.pdf`);
    expect(printContentPdfKey(USER, ALBUM)).toBe(`${USER}/albums/${ALBUM}/print-content.pdf`);
  });

  it('NEVER collides — three kinds, three objects', () => {
    const keys = PDF_KINDS.map((k) => albumPdfKey(USER, ALBUM, k));
    expect(new Set(keys).size).toBe(3);
  });

  it('leaves the pre-existing preview key byte-for-byte unchanged', () => {
    // The literal is mirrored by the worker (pdf-contract.ts) and pinned by a worker test. A
    // change here would strand every preview PDF already in the bucket.
    expect(previewPdfKey('u1', 'a1')).toBe('u1/albums/a1/preview.pdf');
    expect(albumPdfKey('u1', 'a1')).toBe('u1/albums/a1/preview.pdf');
  });

  it('is deterministic — the same inputs always name the same object', () => {
    for (const k of PDF_KINDS) {
      expect(albumPdfKey(USER, ALBUM, k)).toBe(albumPdfKey(USER, ALBUM, k));
    }
  });

  it('scopes every key to its own user AND album', () => {
    const other = '33333333-3333-4333-8333-333333333333';
    expect(albumPdfKey(USER, ALBUM, 'print_cover')).not.toBe(albumPdfKey(other, ALBUM, 'print_cover'));
    expect(albumPdfKey(USER, ALBUM, 'print_cover')).not.toBe(albumPdfKey(USER, other, 'print_cover'));
  });

  it('keeps every artifact inside the album namespace the cleanup understands', () => {
    for (const k of PDF_KINDS) {
      const parts = albumPdfKey(USER, ALBUM, k).split('/');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe(USER);
      expect(parts[1]).toBe('albums');
      expect(parts[2]).toBe(ALBUM);
    }
  });

  it('publishes every basename so the orphan scanner can recognise them', () => {
    // A generated PDF the scanner does not recognise is reported as MALFORMED — or, if the parser
    // were ever loosened, treated as a deletion candidate. This list is what prevents both.
    expect(ALBUM_PDF_BASENAMES).toEqual(['preview.pdf', 'print-cover.pdf', 'print-content.pdf']);
    for (const k of PDF_KINDS) {
      const basename = albumPdfKey(USER, ALBUM, k).split('/').pop()!;
      expect(ALBUM_PDF_BASENAMES).toContain(basename);
    }
  });

  it('cannot be confused with a raw upload or a worker derivative', () => {
    // A raw upload's basename is a bare UUID + an image extension; derivatives carry _full/_thumb.
    for (const k of PDF_KINDS) {
      const basename = albumPdfKey(USER, ALBUM, k).split('/').pop()!;
      expect(basename.endsWith('.pdf')).toBe(true);
      expect(basename).not.toMatch(/_full|_thumb/);
      expect(basename).not.toMatch(/^[0-9a-f-]{36}\./);
    }
  });
});

describe('reclaimability — deleteAlbum can name every object that could exist', () => {
  /**
   * Mirrors the key collection in `deleteAlbum`: for each `album_pdfs` row, take the STORED key
   * (null for the whole duration of a render) and the RECONSTRUCTED key for that row's kind.
   */
  const collect = (rows: { kind: string | null; r2_key: string | null }[]): string[] =>
    Array.from(
      new Set(
        rows
          .flatMap((r) => [r.r2_key, albumPdfKey(USER, ALBUM, toPdfKind(r.kind))])
          .filter((k): k is string => !!k),
      ),
    );

  it('collects all three objects when all three exist', () => {
    const keys = collect([
      { kind: 'preview', r2_key: previewPdfKey(USER, ALBUM) },
      { kind: 'print_cover', r2_key: printCoverPdfKey(USER, ALBUM) },
      { kind: 'print_content', r2_key: printContentPdfKey(USER, ALBUM) },
    ]);
    expect(keys).toHaveLength(3);
    expect(keys).toContain(printCoverPdfKey(USER, ALBUM));
    expect(keys).toContain(printContentPdfKey(USER, ALBUM));
  });

  it('collects a print object whose render CRASHED before r2_key was written', () => {
    // THE crash window: upload succeeded, the process died, finalize never ran. The stored key is
    // still null, so only the deterministic reconstruction can name the object.
    const keys = collect([{ kind: 'print_content', r2_key: null }]);
    expect(keys).toEqual([printContentPdfKey(USER, ALBUM)]);
  });

  it('collects nothing for a kind that was never requested', () => {
    // No row for a kind means no render of that kind ever started, so no object can exist.
    const keys = collect([{ kind: 'preview', r2_key: previewPdfKey(USER, ALBUM) }]);
    expect(keys).toEqual([previewPdfKey(USER, ALBUM)]);
    expect(keys).not.toContain(printCoverPdfKey(USER, ALBUM));
  });

  it('treats a row with no kind as the preview, exactly as a pre-0058 row means', () => {
    expect(collect([{ kind: null, r2_key: null }])).toEqual([previewPdfKey(USER, ALBUM)]);
  });

  it('de-duplicates when the stored and reconstructed keys agree', () => {
    expect(collect([{ kind: 'print_cover', r2_key: printCoverPdfKey(USER, ALBUM) }])).toHaveLength(1);
  });
});

describe('artifact independence', () => {
  /** A minimal model of the composite-key row set the migration establishes. */
  type Row = { albumId: string; kind: PdfKind; status: string; token: string; r2Key: string };
  const row = (kind: PdfKind, status: string): Row => ({
    albumId: ALBUM,
    kind,
    status,
    token: `token-${kind}`,
    r2Key: albumPdfKey(USER, ALBUM, kind),
  });

  it('gives one album a unique row per kind', () => {
    const rows = PDF_KINDS.map((k) => row(k, 'idle'));
    const pks = rows.map((r) => `${r.albumId}:${r.kind}`);
    expect(new Set(pks).size).toBe(3);
  });

  it('lets status differ per artifact', () => {
    const rows = [row('preview', 'ready'), row('print_cover', 'failed'), row('print_content', 'generating')];
    expect(rows.map((r) => r.status)).toEqual(['ready', 'failed', 'generating']);
    // A failed print export leaves the preview READY — the whole point of the composite key.
    expect(rows.find((r) => r.kind === 'preview')!.status).toBe('ready');
  });

  it('gives each artifact its own token', () => {
    const tokens = PDF_KINDS.map((k) => row(k, 'generating').token);
    expect(new Set(tokens).size).toBe(3);
  });

  it('gives each artifact its own R2 key', () => {
    const keys = PDF_KINDS.map((k) => row(k, 'ready').r2Key);
    expect(new Set(keys).size).toBe(3);
  });
});
