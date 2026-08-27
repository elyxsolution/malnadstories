/**
 * Download an album's generated PDFs from R2 and report their PHYSICAL page geometry.
 *
 *   pnpm --filter @workerv2/app exec tsx scripts/inspect-pdf.ts <albumId> [kind...]
 *
 * Reads the MediaBox of every page straight out of the file, because a PDF's page size is the one
 * property that cannot be checked from the HTML that produced it — and it is the property a print
 * partner measures first.
 */
import { inflateSync } from 'node:zlib';
import { loadEnvFiles } from '../src/env.js';
import { loadInfrastructureConfig } from '../src/infra/config.js';
import { R2ObjectStore } from '../src/infra/storage/r2-object-store.js';
import { SupabasePostgresAdapter, postgresSqlClient } from '../src/infra/database/supabase-adapter.js';
import { PDF_KINDS, albumPdfKey, type PdfKind } from '../src/processors/pdf/pdf-contract.js';

const PT_PER_MM = 72 / 25.4;
const mm = (pt: number) => (pt / PT_PER_MM).toFixed(2);

/** Every page's MediaBox, honouring inheritance from /Pages. */
function pageBoxes(buf: Buffer): { count: number; boxes: Map<string, number> } {
  const latin = buf.toString('latin1');
  const objects = [...latin.matchAll(/(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g)];
  const mbOf = (body: string) => {
    const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(body);
    return m ? [m[1], m[2], m[3], m[4]].map(Number) : null;
  };
  let inherited: number[] | null = null;
  for (const [, , body] of objects) if (/\/Type\s*\/Pages/.test(body)) inherited = mbOf(body) ?? inherited;

  const boxes = new Map<string, number>();
  let count = 0;
  for (const [, , body] of objects) {
    if (!/\/Type\s*\/Page[^s]/.test(body)) continue;
    count++;
    const b = mbOf(body) ?? inherited;
    const key = b ? `${(b[2] - b[0]).toFixed(2)} x ${(b[3] - b[1]).toFixed(2)}` : 'unknown';
    boxes.set(key, (boxes.get(key) ?? 0) + 1);
  }
  return { count, boxes };
}

async function main(): Promise<void> {
  const album = process.argv[2];
  const kinds = (process.argv.slice(3).length ? process.argv.slice(3) : [...PDF_KINDS]) as PdfKind[];
  if (!album) {
    console.error('usage: tsx scripts/inspect-pdf.ts <albumId> [kind...]');
    process.exit(1);
  }

  loadEnvFiles();
  const infra = loadInfrastructureConfig(process.env);
  if (infra === null) throw new Error('WV2_INFRA is not enabled');

  const sql = postgresSqlClient(infra.database);
  const db = new SupabasePostgresAdapter(sql);
  const store = R2ObjectStore.fromConfig(infra.storage);

  const owner = await db.query<{ user_id: string }>('select user_id from albums where id = $1', [album]);
  const size = await db.query<{ size: number }>('select size from albums where id = $1', [album]);
  console.log(`\nalbum ${album}  (declared content pages: ${size[0]?.size})\n`);

  for (const kind of kinds) {
    const key = albumPdfKey(owner[0]!.user_id, album, kind);
    try {
      const bytes = await store.read(key);
      if (bytes === null) { console.log(`${kind}
  key    : ${key}
  MISSING in R2`); console.log(); continue; }
      const buf = Buffer.from(bytes);
      const { count, boxes } = pageBoxes(buf);
      console.log(`${kind}`);
      console.log(`  key    : ${key}`);
      console.log(`  bytes  : ${buf.byteLength.toLocaleString()}`);
      console.log(`  pages  : ${count}`);
      for (const [box, n] of boxes) {
        const [w, h] = box.split(' x ').map(Number);
        console.log(`  size   : ${box} pt  =  ${mm(w)} x ${mm(h)} mm   (${n} page${n === 1 ? '' : 's'})`);
      }
    } catch (e) {
      console.log(`${kind}\n  key    : ${key}\n  ERROR  : ${(e as Error).message}`);
    }
    console.log();
  }

  await (sql as unknown as { end: () => Promise<void> }).end();
  void inflateSync;
}

void main();
