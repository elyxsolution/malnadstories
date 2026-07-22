# @workerv2/utils

Pure, generic, **side-effect-free** helpers. Deterministic; no I/O, no globals, no product
knowledge. Depends only on `@workerv2/contracts` (for types).

## Exports

- **Result:** `ok`, `err`, `isOk`, `isErr`, `mapResult`, `mapErr`, `unwrapOr` — constructors and
  combinators for `Result<T,E>`.
- **Invariants:** `invariant(cond, msg)` (assertion), `assertNever(x)` (exhaustiveness).
- **Objects:** `isPlainObject`, `hasOwn`, `deepFreeze` (recursive, cycle-safe).
