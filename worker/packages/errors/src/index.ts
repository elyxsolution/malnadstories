// @workerv2/errors — generic typed error abstraction. No product/domain errors.

export type { ErrorCode, WorkerV2ErrorOptions } from './errors.js';
export {
  WorkerV2Error,
  ConfigError,
  ValidationError,
  InvariantError,
  NotImplementedError,
  DependencyError,
  isWorkerV2Error,
} from './errors.js';
