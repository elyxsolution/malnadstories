# App regression suite

`pnpm test` — Vitest, node environment, no database, no network, no fixtures.

The worker has its own suite (`cd worker && pnpm test`, 141 files / 1220 tests) and owns
everything worker-side: the PDF pipeline, the deletion race, orphan scan/cleanup safety, image
hardening, recovery. **These tests do not duplicate it.** This suite covers app-side commerce
domain logic that had no durable coverage before Phase 9 Prompt 4.

| file | protects |
|---|---|
| `combined-order.test.ts` | one order → many `order_items`; each line keeps its own album/copies/title/product; purchase order preserved; no first-album-only collapse; snapshot immutability under a later album rename |
| `settlement.test.ts` | the paid-transition cascade fans out over `order_items` (not `orders.album_id`); one email per order; cart cleared only for this order's albums and owner; the paid-family floor; never throws; never writes `orders.status` |
| `pricing-combined.test.ts` | shipping charged ONCE per order; order subtotal == Σ line subtotals; a one-line combined order == the single-album path; discount clamped to subtotal |
| `order-emails.test.tsx` | confirmation + fulfilment emails represent every purchased album using snapshot titles; single-album wording unchanged; no live-title leak. Renders the real templates; sends nothing |
| `customer-order-status.test.tsx` | `_status.tsx` renders one CTA per album, each pointing at its own album; single-album experience unchanged |
| `cart-eligibility.test.ts` | manual add increments, submit auto-add is `do nothing`; ownership / blueprint / submitted gates; identity from `auth.uid()`; badge counts distinct albums |
| `pdf-blueprint-gate.test.ts` | a blueprint draft can never generate a PDF — `force`, `override` and every combination are refused before anything is written; PDF start stays idempotent |
| `album-title.test.ts` | derived-title fallback chain; never empty; 100 **code point** cap; ZWJ/ZWNJ preserved for Indic and emoji |
| `migration-inventory.test.ts` | migration ids/filenames unique and contiguous; CLAUDE.md documents every file on disk, in order, and invents none |

## What is deliberately NOT here

- **Database-level guarantees.** Atomic cart increment, the `quantity <= 10` cap, RLS row
  filtering, `create_order_with_items`' money re-checks, the `orders_one_pending_per_album`
  index, and the TRUNCATE revoke are enforced by Postgres. They were verified against the live
  database with real JWTs in Phases 6–9 and cannot be re-proved without one. **The only database
  available to this repository is production**, so the suite does not touch a database at all.
  Reproving them needs a disposable Postgres — see the risk register in the Phase 9 Prompt 4
  report.
- **Admin server components** (`/admin/production`, `/admin/orders`, `/admin/customers/[id]`,
  `/admin/shipping`, the dashboard). Each is an async React Server Component with its Drizzle
  query written inline, so there is nothing importable to assert against without either a
  database or extracting the query into a helper — a production refactor done purely for tests,
  which Phase 9 Prompt 4 was instructed not to do. Their Phase 9 P2 behaviour was proven in the
  browser against seeded fixtures and is recorded there.

## Fixtures

There are none: every test in this suite is pure. **If a future test needs database fixtures it
must follow the mandatory procedure in CLAUDE.md → *Destructive operations & test data*** —
explicit ids, an external manifest, a pre-mutation fingerprint, exact-PK deletion, an ownership
re-check immediately before deleting, and a post-run fingerprint comparison. Never clean up by
pattern, name, email or timestamp.
