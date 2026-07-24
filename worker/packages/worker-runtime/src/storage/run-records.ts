import type { StorageBackend } from './backend.js';

/**
 * The RUN RECORD STORE — a small durable index mapping a run id to the content-addressed inputs
 * needed to RECONSTRUCT its coordinator on restart: the blueprint key (its content is already in the
 * durable artifact store) and the manifest hash. On recovery a runtime reads the record, re-reads
 * the blueprint from the artifact store, re-prepares the (identical) coordinator, loads the durable
 * journal, and resumes — reusing the Coordinator's own resume semantics. These are mutable pointers
 * (not content-addressed), namespaced `run:<id>` so they never collide with artifacts.
 */
export interface RunRecord {
  readonly runId: string;
  readonly blueprintKey: string;
  readonly manifestHash: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PREFIX = 'run:';

export class RunRecordStore {
  constructor(private readonly backend: StorageBackend) {}

  save(record: RunRecord): void {
    this.backend.put(`${PREFIX}${record.runId}`, encoder.encode(JSON.stringify(record)));
  }

  load(runId: string): RunRecord | undefined {
    const bytes = this.backend.get(`${PREFIX}${runId}`);
    if (bytes === undefined) return undefined;
    return JSON.parse(decoder.decode(bytes)) as RunRecord;
  }

  /** All recorded run ids (for recovering every interrupted run at startup). */
  runIds(): readonly string[] {
    return this.backend
      .keys()
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length));
  }
}
