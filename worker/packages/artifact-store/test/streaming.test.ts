import { describe, expect, it } from 'vitest';
import {
  ContentAddressedArtifactStore,
  InMemoryBlobStore,
  Sha256ContentAddressing,
} from '@workerv2/artifact-store';
import { bytes, streamOf } from './helpers.js';

const addressing = new Sha256ContentAddressing();

function makeStore(): ContentAddressedArtifactStore {
  return new ContentAddressedArtifactStore(new InMemoryBlobStore());
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('streaming interfaces', () => {
  it('chunking never changes identity — streamed and whole-buffer writes agree', async () => {
    const whole = await makeStore().putContent(bytes(1, 2, 3, 4, 5));
    const streamed = await makeStore().putStream(streamOf(bytes(1), bytes(2, 3), bytes(4, 5)));
    expect(streamed.key).toBe(whole.key);
    expect(streamed.sizeBytes).toBe(5);
  });

  it('round-trips content through putStream → getStream', async () => {
    const store = makeStore();
    const meta = await store.putStream(streamOf(bytes(10, 11), bytes(12)), 'application/pdf');
    expect(meta.contentType).toBe('application/pdf');

    const stream = await store.getStream(meta.key);
    expect(stream).not.toBeNull();
    const chunks = await collect(stream as AsyncIterable<Uint8Array>);
    const flat = new Uint8Array(chunks.flatMap((c) => [...c]));
    expect(flat).toStrictEqual(bytes(10, 11, 12));
  });

  it('handles the empty stream (zero-byte artifact) correctly', async () => {
    const store = makeStore();
    const meta = await store.putStream(streamOf());
    expect(meta.sizeBytes).toBe(0);
    expect(meta.key).toBe(addressing.address(new Uint8Array(0)));
    expect(await store.get(meta.key)).toStrictEqual(new Uint8Array(0));
  });

  it('streams large content back in bounded chunks', async () => {
    const store = makeStore();
    const big = new Uint8Array(150 * 1024).fill(7); // > 2 × 64 KiB read-chunk size
    const meta = await store.putStream(streamOf(big));
    const stream = await store.getStream(meta.key);
    const chunks = await collect(stream as AsyncIterable<Uint8Array>);
    expect(chunks.length).toBeGreaterThan(1); // actually chunked
    expect(chunks.every((c) => c.byteLength <= 64 * 1024)).toBe(true);
    expect(chunks.reduce((n, c) => n + c.byteLength, 0)).toBe(big.byteLength);
  });

  it('a caller mutating source chunks after the write cannot alter the stored bytes', async () => {
    const store = makeStore();
    const chunk = bytes(1, 2, 3);
    const meta = await store.putStream(streamOf(chunk));
    chunk[0] = 99;
    expect(await store.get(meta.key)).toStrictEqual(bytes(1, 2, 3));
  });
});
