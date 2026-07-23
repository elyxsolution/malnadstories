import type { ExecutionEvent, ExecutionEventPublisher } from '@workerv2/coordinator';
import type { EventSink } from './contracts.js';

/**
 * Reference EVENT SINKS. Publication is a replaceable seam: collect for tests, discard, or
 * bridge to the Coordinator's synchronous `ExecutionEventPublisher` contract. A production host
 * injects a bus/queue publisher — the adapter neither knows nor cares which.
 */

/** Collects published events in order — the test/inspection sink. */
export class InMemoryEventSink implements EventSink {
  readonly events: ExecutionEvent[] = [];

  publish(event: ExecutionEvent): void {
    this.events.push(event);
  }
}

/** Discards every event. */
export const noopEventSink: EventSink = {
  publish: (): void => {},
};

/** Bridge a Coordinator `ExecutionEventPublisher` (sync) into an adapter `EventSink`. */
export function publisherSink(publisher: ExecutionEventPublisher): EventSink {
  return { publish: (event: ExecutionEvent): void => publisher.publish(event) };
}
