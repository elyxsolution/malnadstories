# @workerv2/flags

**Feature-flag framework**: the `FlagProvider` abstraction + a static reference provider. No
product flags — those are supplied by consumers/config. Depends on `@workerv2/contracts`.

## Exports

- `FlagProvider` — `isEnabled(key)` (boolean flags), `getValue(key, fallback)` (typed, never
  `undefined`).
- `StaticFlagProvider` — in-memory map (copied defensively); reference impl for tests and
  statically-configured flags. Remote/dynamic providers satisfy the same interface later.
- `FlagValue` = `boolean | number | string`.
