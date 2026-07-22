/**
 * The technical-event types the runtime lifecycle emits (INV-12 operational stream). Values are
 * stable `subject.past_tense`-style names — treat them as a contract.
 */
export const RUNTIME_EVENTS = {
  starting: 'runtime.starting',
  started: 'runtime.started',
  stopping: 'runtime.stopping',
  stopped: 'runtime.stopped',
  serviceStarted: 'runtime.service_started',
  serviceStopped: 'runtime.service_stopped',
} as const;

export type RuntimeEventType = (typeof RUNTIME_EVENTS)[keyof typeof RUNTIME_EVENTS];
