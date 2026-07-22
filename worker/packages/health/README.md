# @workerv2/health

Generic **health framework**: a check registry that aggregates named checks into a single
report. No product checks — those are registered by later subsystems. Depends on
`@workerv2/contracts`.

## Exports

- `HealthCheck` — `{ name, check(): HealthCheckResult | Promise<...> }`.
- `HealthRegistry` — `register`, `unregister`, `run()` (parallel; aggregate = worst status;
  empty ⇒ `healthy`; a throwing check ⇒ `unhealthy`).
- `HealthStatus`, `HealthReport`, `STATUS_SEVERITY`, `worseStatus(a, b)`.
