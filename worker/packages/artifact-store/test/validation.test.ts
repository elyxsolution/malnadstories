import { describe, expect, it } from 'vitest';
import {
  artifactDescriptorValidator,
  describeArtifact,
  validateArtifactDescriptor,
} from '@workerv2/artifact-store';
import { bytes, provenance, unwrap } from './helpers.js';

/** A JSON-safe clone, simulating a raw row read back from a durable backend. */
function asUntrusted(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const goodDescriptor = (): unknown =>
  asUntrusted(describeArtifact(bytes(1, 2, 3), provenance(), 'image/jpeg'));

describe('artifact validation (untrusted-input boundary)', () => {
  it('accepts a well-formed descriptor and reconstructs typed value objects', () => {
    const result = validateArtifactDescriptor(goodDescriptor());
    const descriptor = unwrap(result);
    expect(descriptor).toStrictEqual(describeArtifact(bytes(1, 2, 3), provenance(), 'image/jpeg'));
  });

  it('accepts a descriptor without contentType', () => {
    const descriptor = unwrap(
      validateArtifactDescriptor(asUntrusted(describeArtifact(bytes(1), provenance()))),
    );
    expect(descriptor.contentType).toBeUndefined();
  });

  it('is exposed as a Validator object', () => {
    expect(artifactDescriptorValidator.validate(goodDescriptor()).ok).toBe(true);
    expect(artifactDescriptorValidator.validate(null).ok).toBe(false);
  });

  const reject = (mutate: (d: Record<string, unknown>) => void): void => {
    const raw = goodDescriptor() as Record<string, unknown>;
    mutate(raw);
    const result = validateArtifactDescriptor(raw);
    expect(result.ok).toBe(false);
  };

  it('rejects non-objects', () => {
    expect(validateArtifactDescriptor(null).ok).toBe(false);
    expect(validateArtifactDescriptor('x').ok).toBe(false);
    expect(validateArtifactDescriptor([]).ok).toBe(false);
  });

  it('rejects an unknown algorithm', () => reject((d) => (d.algorithm = 'md5')));
  it('rejects a non-hex digest', () => reject((d) => (d.digest = 'ZZZ')));
  it('rejects a key that disagrees with algorithm:digest', () =>
    reject((d) => (d.key = 'sha256:0000')));
  it('rejects a negative size', () => reject((d) => (d.sizeBytes = -1)));
  it('rejects a fractional size', () => reject((d) => (d.sizeBytes = 1.5)));
  it('rejects a non-string contentType', () => reject((d) => (d.contentType = 42)));
  it('rejects a missing provenance', () => reject((d) => delete d.provenance));

  const rejectProvenance = (mutate: (p: Record<string, unknown>) => void): void =>
    reject((d) => mutate(d.provenance as Record<string, unknown>));

  it('rejects an empty provenance step', () => rejectProvenance((p) => (p.step = '  ')));
  it('rejects an unknown artifact kind', () => rejectProvenance((p) => (p.kind = 'misc')));
  it('rejects a blank runId', () => rejectProvenance((p) => (p.runId = ' ')));
  it('rejects non-object versions', () => rejectProvenance((p) => (p.versions = 'v1')));
  it('rejects non-string version pins', () =>
    rejectProvenance((p) => (p.versions = { imageEngine: 1 })));
  it('rejects non-array sourceAssetIds', () =>
    rejectProvenance((p) => (p.sourceAssetIds = 'ast-1')));
  it('rejects non-string source asset ids', () =>
    rejectProvenance((p) => (p.sourceAssetIds = [7])));
  it('rejects an invalid createdAt timestamp', () =>
    rejectProvenance((p) => (p.createdAt = 'not-a-date')));
});
