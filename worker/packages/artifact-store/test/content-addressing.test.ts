import { describe, expect, it } from 'vitest';
import {
  CONTENT_HASH_ALGORITHM,
  Sha256ContentAddressing,
  digestOf,
  formatStorageKey,
  hashBytes,
} from '@workerv2/artifact-store';
import type { StorageKey } from '@workerv2/infra-contracts';
import { bytes } from './helpers.js';

describe('content addressing (deterministic, backend-independent identity)', () => {
  const addressing = new Sha256ContentAddressing();

  it('identical content → identical address, deterministically', () => {
    const a = addressing.address(bytes(1, 2, 3));
    const b = addressing.address(bytes(1, 2, 3));
    expect(a).toBe(b);
    // Fresh instance — identity depends on the bytes alone, not on any instance state.
    expect(new Sha256ContentAddressing().address(bytes(1, 2, 3))).toBe(a);
  });

  it('different content → different address', () => {
    expect(addressing.address(bytes(1, 2, 3))).not.toBe(addressing.address(bytes(1, 2, 4)));
  });

  it('matches the known sha256 test vector for empty content', () => {
    // sha256 of zero bytes is a published constant — pins the algorithm itself.
    expect(hashBytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('formats keys as algorithm:digest and parses the digest back', () => {
    const digest = hashBytes(bytes(7));
    const key = formatStorageKey(digest);
    expect(key).toBe(`${CONTENT_HASH_ALGORITHM}:${digest}`);
    expect(digestOf(key)).toBe(digest);
  });

  it('digestOf rejects malformed keys', () => {
    expect(digestOf('md5:abc' as StorageKey)).toBeNull();
    expect(digestOf('sha256:' as StorageKey)).toBeNull();
    expect(digestOf('garbage' as StorageKey)).toBeNull();
  });
});
