# @workerv2/di

Dependency-injection **container foundation** (generic). Token-based registration/resolution,
singleton caching, child scopes, and cycle detection. **No product wiring** — later phases
build their dependency graphs on top of this. Depends on `@workerv2/contracts`,
`@workerv2/errors`.

## Exports

- `token<T>(description)` → `Token<T>` — a unique, typed injection token.
- `Container` — `registerValue`, `registerFactory(…, { singleton })`, `resolve`, `has`,
  `createChild()`. Unregistered tokens and cycles throw `DependencyError`.
- `Factory<T>` — `(container) => T`.

## Notes

- Singletons cache within the scope that owns the registration.
- Child scopes inherit and may override parent registrations.
- Cycle detection throws `DependencyError` rather than overflowing the stack.
