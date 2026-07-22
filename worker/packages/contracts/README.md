# @workerv2/contracts

The **neutral shared-contracts home** (WBS 2.2.1). Types and interfaces only — **no runtime
behavior, no product knowledge**. Everything downstream may depend on this package; it depends
on nothing.

## Exports

| Export                                                  | Kind      | Purpose                                                             |
| ------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `Result<T,E>`, `Ok<T>`, `Err<E>`                        | type      | Explicit success/failure value (constructors in `@workerv2/utils`). |
| `Brand<T,B>`                                            | type      | Nominal typing helper for meaningful primitives.                    |
| `JsonValue`, `JsonObject`, `JsonArray`, `JsonPrimitive` | type      | JSON-safe boundary shapes.                                          |
| `Disposable`                                            | interface | Idempotent resource release.                                        |
| `DeepReadonly<T>`                                       | type      | Compile-time deep immutability.                                     |
| `SemVer`                                                | type      | Branded semantic-version string.                                    |
| `CONTRACTS_VERSION`                                     | const     | Version of the contracts surface (ADR-gated to bump).               |

## Stability policy

This is the highest-leverage package in the foundation. Any breaking change to an exported
contract is an **ADR-level event** and bumps `CONTRACTS_VERSION` (Engineering Playbook §4.2.1).
