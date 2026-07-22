# @workerv2/runtime

The Worker V2 **Runtime** — the generic framework that will host future capabilities. It owns
process lifecycle, registries, extension, and operational visibility; it owns **no product
behavior**.

> **Scope (Phase 2).** Runtime lifecycle, service/capability registries, a plugin framework,
> DI/config/health integration, immutable runtime metadata, and technical lifecycle events.
> **Not here:** coordinator, queue, jobs/handlers, storage, or any domain/product logic — those
> are later phases.

## Dependencies & boundaries

Depends inward on the foundation packages (`di`, `config`, `health`, `build-info`, `logger`,
`contracts`, `utils`, `errors`) and on `@workerv2/control-plane` for **two generic contracts
only**: the `defineStateMachine` engine (the runtime's own lifecycle) and the `TechnicalEvent`
model (INV-12). It imports **no** domain aggregate, lifecycle, policy, or version-set — so it
introduces no domain behavior. The boundary checker enforces the package-level direction.

## What's inside

- **`Runtime`** — build with injected `now` / `nextId` (deterministic), plus config, build info,
  plugins, and services. `create()` validates the dependency graph and fails fast; `start()` /
  `stop()` are **idempotent** and drive services in deterministic dependency order.
- **Lifecycle** — `RUNTIME_MACHINE` (`created → starting → running → stopping → stopped`, `+ failed`).
- **Service registry + dependency graph** — `ServiceRegistry`, `orderServices` (Kahn's algorithm,
  name-sorted tie-breaking → deterministic order; rejects missing deps and cycles).
- **Capability registry** — `CapabilityRegistry` (named, de-duplicated capability markers).
- **Plugin framework** — `Plugin` / `PluginContext` / `applyPlugins`: additive extension that
  registers services + capabilities (and DI bindings) once, synchronously, at build time.
- **DI integration** — `createRuntimeContainer` + `LoggerToken` / `ConfigToken` / `MetadataToken`.
- **Runtime metadata** — immutable `RuntimeMetadata` (id, name, environment, build info).
- **Runtime config** — `readRuntimeConfig` over an injected `EnvSource` (immutable result).
- **Health integration** — `buildRuntimeHealth` composes a runtime liveness check with each
  service's optional health contribution over `@workerv2/health`.
- **Technical events** — `TechnicalEventBus` (sync, isolated listeners) + `RUNTIME_EVENTS`; the
  runtime publishes `runtime.starting/started/service_started/stopping/service_stopped/stopped`.

## Guarantees

Framework-independent · deterministic startup (validated graph + stable ordering + injected
time/ids) · immutable runtime metadata · dependency-graph validation · no circular dependencies
· no domain behavior.
