# @workerv2/config

Generic **configuration framework + environment validation**. Product-agnostic: validation is
**injected** by the consumer (dependency inversion) — this package holds no schema library and
no product config. Depends on `@workerv2/contracts`, `@workerv2/errors`, `@workerv2/utils`.

## Exports

- **Env:** `requireEnv`, `optionalEnv`, `boolEnv` over an injectable `EnvSource` (default
  `process.env`). Missing/invalid values throw `ConfigError`.
- **Config:** `loadConfig(raw, validate, label?)` — runs an injected `ConfigValidator<T>`,
  normalizes any failure to `ConfigError`, and returns a **deep-frozen** (immutable) value.
