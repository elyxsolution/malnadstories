/**
 * Infrastructure DTOs — the PERSISTENCE models. These are flat, JSON-safe records, deliberately
 * distinct from the domain aggregates (branded ids/timestamps are stored as plain strings). They
 * are what a persistence adapter reads and writes; the domain never sees them directly — mappers
 * (the anti-corruption layer) translate between these and domain objects.
 */

export interface AlbumRecord {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssetRecord {
  readonly id: string;
  readonly albumId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RunRecord {
  readonly id: string;
  readonly albumId: string;
  readonly status: string;
  /** Frozen version pins (component → semver), mirroring the run's VersionSet. */
  readonly versions: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditRecordDto {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly actorKind: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly fromState?: string;
  readonly toState?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
