import { deepFreeze } from '@workerv2/utils';
import { StorageError } from '@workerv2/infra-contracts';
import type { ArtifactDescriptor, ArtifactRegistry, StorageKey } from '@workerv2/infra-contracts';
import type { RunId } from '@workerv2/control-plane';

/** Canonical JSON (sorted keys) used for structural descriptor equality. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The in-memory ARTIFACT REGISTRY — the write-once index from a content address to its immutable
 * `ArtifactDescriptor` (integrity + provenance). Guards:
 *
 * - **Write-once (INV-2):** a key's descriptor never changes; registering a CONFLICTING
 *   descriptor for an existing key is rejected (`StorageError`).
 * - **Idempotent (INV-7):** re-registering the structurally IDENTICAL descriptor is a no-op —
 *   safe under retries and duplicate deliveries.
 * - **Immutable hand-outs:** descriptors are deep-frozen on registration; readers can never
 *   mutate registry state through a returned object.
 *
 * Metadata only — bytes live in the `ArtifactStore` under the same key.
 */
export class InMemoryArtifactRegistry implements ArtifactRegistry {
  private readonly descriptors = new Map<string, ArtifactDescriptor>();

  async register(descriptor: ArtifactDescriptor): Promise<void> {
    const existing = this.descriptors.get(descriptor.key);
    if (existing !== undefined) {
      if (canonicalize(existing) === canonicalize(descriptor)) return; // idempotent re-register
      throw new StorageError(
        `Refusing to re-register artifact "${descriptor.key}" with a different descriptor`,
        { context: { key: descriptor.key } },
      );
    }
    const stored = structuredClone(descriptor);
    deepFreeze(stored);
    this.descriptors.set(descriptor.key, stored);
  }

  async get(key: StorageKey): Promise<ArtifactDescriptor | null> {
    return this.descriptors.get(key) ?? null;
  }

  async has(key: StorageKey): Promise<boolean> {
    return this.descriptors.has(key);
  }

  async list(): Promise<readonly ArtifactDescriptor[]> {
    return [...this.descriptors.values()];
  }

  async byRun(runId: RunId): Promise<readonly ArtifactDescriptor[]> {
    return [...this.descriptors.values()].filter((d) => d.provenance.runId === runId);
  }
}
