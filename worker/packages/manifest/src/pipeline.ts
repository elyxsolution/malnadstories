import type { Result } from '@workerv2/contracts';
import type {
  PipelineDefinitionError,
  ProcessingPipeline,
  ProcessingPipelineSpec,
} from '@workerv2/processing';
import { definePipeline } from '@workerv2/processing';
import type { CompiledManifest } from './compile.js';

/**
 * The PROCESSING BRIDGE — a compiled manifest expressed as a declarative
 * `ProcessingPipeline` (INV-5). Because the manifest model REUSES the processing framework's
 * ids, bindings, capability requirements, and policies, the mapping is lossless and purely
 * structural: work nodes become steps unchanged. The pipeline id embeds the manifest's
 * content hash, so the pipeline names EXACTLY which manifest it executes. Still pure data —
 * an engine (a later phase) interprets the pipeline; nothing here executes.
 */

/** The `ProcessingPipelineSpec` equivalent of a compiled manifest (pure mapping, no validation). */
export function toPipelineSpec(compiled: CompiledManifest): ProcessingPipelineSpec {
  return {
    id: `manifest:${compiled.hash}`,
    name: `Manifest work for album ${compiled.manifest.albumId}`,
    version: compiled.manifest.schemaVersion,
    steps: compiled.manifest.nodes.map((node) => ({
      id: node.id,
      processor: node.processor,
      ...(node.processorVersionRange === undefined
        ? {}
        : { processorVersionRange: node.processorVersionRange }),
      dependsOn: node.dependsOn,
      inputs: node.consumes,
      outputs: node.produces,
      requires: node.requires,
      config: node.config,
      retry: node.retry,
      ...(node.timeout === undefined ? {} : { timeout: node.timeout }),
      cancellation: node.cancellation,
      failure: node.failure,
    })),
  };
}

/**
 * Bridge a compiled manifest into a validated `ProcessingPipeline` via `definePipeline` —
 * proving BY CONSTRUCTION that every manifest is consumable by the declarative processing
 * model (and therefore by any engine that interprets it).
 */
export function toPipeline(
  compiled: CompiledManifest,
): Result<ProcessingPipeline, PipelineDefinitionError> {
  return definePipeline(toPipelineSpec(compiled));
}
