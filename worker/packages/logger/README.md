# @workerv2/logger

Logging **abstraction** (the `Logger` interface) plus minimal reference implementations. This
is the foundation seam only — the full observability platform (correlation ids, remote sinks,
sampling) is a later phase. Depends on `@workerv2/contracts`.

## Exports

- `Logger` — the abstraction: `debug/info/warn/error(message, fields?)` + `child(fields)`.
- `ConsoleLogger` — structured single-line JSON; injectable `level`, `base` fields, `sink`, `now`.
- `NoopLogger` — discards everything (safe default / tests).
- `LogLevel`, `LogFields`, `LEVEL_ORDER`.

Log `fields` must be JSON-safe and free of secrets/PII (Playbook §4.3.2).
