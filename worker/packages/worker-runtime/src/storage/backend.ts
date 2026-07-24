import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The durable STORAGE BACKEND seam — a tiny, SYNCHRONOUS key→bytes store. Keeping it synchronous
 * lets the artifact store expose the composition root's `put(bytes) → key` API unchanged while
 * persisting durably. Two references ship: an in-memory backend (shareable across runtime instances
 * to SIMULATE a restart) and a filesystem backend (genuine cross-restart durability). A real
 * deployment plugs an object-store/KV backend in here — nothing above this seam changes.
 */
export interface StorageBackend {
  get(key: string): Uint8Array | undefined;
  put(key: string, bytes: Uint8Array): void;
  has(key: string): boolean;
  delete(key: string): void;
  keys(): readonly string[];
}

/** An in-memory backend. Share ONE instance across two runtimes to model durable state at restart. */
export class InMemoryStorageBackend implements StorageBackend {
  private readonly map = new Map<string, Uint8Array>();

  get(key: string): Uint8Array | undefined {
    const v = this.map.get(key);
    return v === undefined ? undefined : new Uint8Array(v);
  }
  put(key: string, bytes: Uint8Array): void {
    this.map.set(key, new Uint8Array(bytes));
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  keys(): readonly string[] {
    return [...this.map.keys()].sort();
  }
}

/**
 * A filesystem-backed backend — genuinely durable across process restarts. Keys are base64url-encoded
 * into filenames (reversible + filesystem-safe), so `keys()` round-trips. Fully synchronous.
 */
export class FileSystemStorageBackend implements StorageBackend {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  get(key: string): Uint8Array | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    return new Uint8Array(readFileSync(path));
  }
  put(key: string, bytes: Uint8Array): void {
    writeFileSync(this.pathFor(key), bytes);
  }
  has(key: string): boolean {
    return existsSync(this.pathFor(key));
  }
  delete(key: string): void {
    const path = this.pathFor(key);
    if (existsSync(path)) rmSync(path);
  }
  keys(): readonly string[] {
    return readdirSync(this.root)
      .map((name) => decode(name))
      .sort();
  }

  private pathFor(key: string): string {
    return join(this.root, encode(key));
  }
}

function encode(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}
function decode(name: string): string {
  return Buffer.from(name, 'base64url').toString('utf8');
}
