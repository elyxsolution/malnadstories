/** The shared pipeline execution model + processor-event system, reused by every processor. */

export { Pipeline } from './pipeline.js';
export type { Stage, PipelineRun } from './pipeline.js';
export { LoggingEventSink, NoopEventSink } from './events.js';
export type { ProcessorEvent, ProcessorEventType, ProcessorEventSink } from './events.js';
