# @workerv2/errors

Generic typed **error abstraction**. Engineering error kinds only — **no product/domain
errors** (those belong to their own subsystems in later phases). Depends on
`@workerv2/contracts`.

## Exports

- `WorkerV2Error` — base class with a stable `code: ErrorCode` and JSON-safe `context`.
- Subclasses: `ConfigError`, `ValidationError`, `InvariantError`, `NotImplementedError`,
  `DependencyError`.
- `isWorkerV2Error(x)` — type guard.

## Rules

- Discriminate programmatically on `code`, never on message text.
- `context` must be sanitized/JSON-safe — **never** put secrets or PII in it (Playbook §4.3.2).
