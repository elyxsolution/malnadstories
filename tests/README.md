# App regression suite

`pnpm test` — Vitest, node environment, no database, no network, no fixtures.

The worker has its own suite (`cd worker && pnpm test`, 141 files / 1235 tests) and owns
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
| `builder-page-and-cover.test.ts` | base slots are POSITIONAL (clearing the left photo never slides the right one across), the hole survives save/reload/Zod, a page is a background rather than a photo container, print-readiness counts photo FRAMES not page halves, and the front/spine/back cover colours are independently stored, migrated and applied |
| `overlay-image-adjust.test.ts` | image adjustment inside a FIXED frame: cover-fit with no distortion in every frame shape, zoom/pan clamped so no blank edge is reachable, the pan range the drag maths converts against, and the exact crop restored from the persisted `edit_config` |
| `builder-workspace-fit.test.ts` | the album is fitted to the measured workspace on BOTH axes (so 100% needs no scrolling) with editor zoom composing on top and album/page/overlay coordinates untouched; and a new spread's starting frames are TWO ordinary EMPTY overlays — one per page, meeting exactly at the fold with no overlap or gap, each photo-less, page ownership carried by geometry alone, a panorama still getting one full-pair frame, valid through the save schema, and reported as waiting rather than blank |
| `print-spec.test.ts` | EVERY physical print dimension, typed from the supplied `dimensions.pdf` rather than derived from the code: 200 × 285 trim, 3 mm bleed, 206 × 291 artwork, 15 mm interior safe area (the product decision that overrides Plate 01's 10 mm), the 210/10/17/10/210 cover construction, 457 × 297 finished spread, 487 × 327 artwork, 15 mm wrap, the 12 mm cover safe area derived from Plate 02, both PDF MediaBoxes in points, the fragmentainer rounding, scale-to-fill's aspect preservation, and **17 mm spine for every page count with no formula anywhere in the range** |
| `print-content-export.test.tsx` | the interior file is exactly the interior: 24/36/48 (and unshipped counts) → that many pages, reading order 1 → N, block order respected, and NO cover, spine, blank, filler or printer mark. Renders the real `_print-content` |
| `print-cover-export.test.tsx` | ONE 487 × 327 page; five panels at 210/10/17/10/210 summing to 457; the spread inset by exactly one 15 mm wrap and clipped so nothing can reach the turn-in; safe areas advisory and never drawn; and a spine carrying **only** its background colour + title — screen-only edge shading and inset shadow suppressed, no photo. Renders the real `_print-cover` |
| `print-storage.test.ts` | the kind vocabulary and its preview default; one deterministic R2 key per (user, album, kind) with no collisions; the preview key byte-identical to before; and the RECLAIMABILITY contract — `deleteAlbum` can name every object that could exist, including one whose render crashed before `r2_key` was written |
| `print-security.test.ts` | the print-route token gate: missing/wrong/expired/absent-expiry tokens refused, the bounded reuse window anchored to first use, and both isolations — a token for another ALBUM and a token for another ARTIFACT of the same album are refused. The raw token never reaches a log line |
| `print-preflight.test.ts` | the interior page-count invariant: a complete album passes, any mismatch is refused before a job is enqueued, rows the renderer would drop are ignored so the gate and the route agree, and both reads fail CLOSED |
| `preview-pdf-unchanged.test.tsx` | THE regression guard for the customer preview book: its own page sequence (cover + 2 blanks + N content + 2 blanks + back + spine), the album PRODUCT dimensions rather than any print constant, and a spine that keeps its advisory page-count-dependent width AND its on-screen edge shading — the two things the print export deliberately changes |
| `print-guides.test.tsx` | the white-hairline fix (no white border, no shadow, artwork still covering the whole bleed box) and the cover’s exported dotted lines — four folds at 225/235/248/258 mm, the finished-edge rule, the drawing’s measured dash patterns, black, confined to the finished spread so the wrap stays blank; plus the guarantee that no builder caption, overlay or region label reaches either PDF |
| `supabase-timeout.test.ts` | the bound that keeps a Supabase outage from becoming a site outage (the 2026-08-28 `MIDDLEWARE_INVOCATION_TIMEOUT`): a never-answering request is torn down rather than held, ONE budget is shared across a request's Supabase calls so the tail cannot multiply, an exhausted auth deadline reports "no user" so every guard fails CLOSED, and a healthy call plus a real error are both passed through untouched |
| `login-error-classification.test.ts` | sign-in tells the truth about WHY it failed: an unreachable Supabase Auth is reported as a service failure and captured, a rejected credential still says "Invalid email or password", unknown-email and wrong-password stay indistinguishable (no enumeration oracle), and success still redirects to /dashboard |
| `builder-bars-and-spine.test.tsx` | the object toolbar can never land inside the page toolbar's reserved band (swept across every overlay position and size, not one screenshot), the page bar keeps its larger gap, the no-band path is unchanged; and the inline text editor takes its font size from `textFontSize` rather than a copy — so a spine object is `cqh` in the editor as well as the renderer, which is what stopped spine text shrinking while typing |
| `builder-zoom-wheel.test.ts` | ctrl/meta + wheel zooms the BOOK and prevents the browser default, a plain wheel is neither prevented nor zoomed (ordinary scrolling intact), a horizontal-only gesture is ignored, propagation is never stopped (so the deeper crop-wheel keeps priority), the listener is `{ passive: false }` and detaches on cleanup — and the scoping: bound to the canvas elements only, never to `window`/`document`, driving the ONE existing `zoomBy` with its single set of bounds, touching no scroll position |
| `builder-text-autofit.test.tsx` | the text box follows the ink: a measured size becomes a normalized box, the fit holds the vertical centre and the alignment-appropriate horizontal edge (so words never walk), multi-line height is carried by the measurement alone, and the loop is closed STRUCTURALLY — the typography signature that triggers a fit contains no geometry, and a fit writes nothing but geometry, so re-fitting unchanged text is a no-op. Also: spine and empty text are exempt, sub-pixel jitter is ignored, the resize minimum equals the smallest fittable box, and the fit is written as an `amend` (no second undo step) and suppressed while a drag or the inline editor owns the element |
| `cover-overlays.test.tsx` | **`back cover background ≠ back cover overlay`** — the brief's Cases A–D run against the real transitions: add, replace, drop-replace and delete each keep the exact background colour (and a background image), preserve every other face property and every sibling overlay, leave the backdrop's `photoId`/`imageEdit` null, and never touch the front or spine; plus the contrast case showing that setting the BACKDROP does clear the background, which is why the two paths must never meet. Also: the back cover carries ORDINARY overlays: the same `Overlay` type, the same `nextOverlayGeom` placement the page canvas uses, the same `OverlaySchema` bounds and cap on save, ids minted on load and never persisted, absent-on-legacy configs reading as none, and `isCustomCover`/`hasBackCover` counting them. Renders the real `BackCoverDesign`: the chosen image appears with no border/shadow/radius, in the same positioned+clipped container a page overlay uses, above the backdrop and below the text; an unfilled or deleted-photo frame draws nothing. Plus the editing wiring (Add overlay → picker → `replaceOverlay`, Movable, select/layer/delete, photo edits routed to the `photos` row) and the printer-ready cover resolving and waiting for its overlay images |
| `builder-text-size.test.tsx` | text size as ONE property with three affordances: a partially-typed number is never clamped under the caret (the root cause of "180 will not go in"), a committed field echoes exactly what the model took, the up/down steppers are reversible, a CORNER drag scales the font while a SIDE handle reflows, a 200-frame drag lands where a 1-frame drag does (no cumulative scaling) and is reversible after hitting a bound, the bounding box tracks the size about its own centre, the save schema accepts everything the editor does (no 160 ceiling anywhere), the rendered `font-size` is derived from `size` with no `transform: scale`, and an overlay renders as a plain clipped image with no border, shadow or radius on either the shared renderer or the canvas |
| `builder-print-guides.test.tsx` | the builder overlays as rendered components: one trim rectangle PER PAGE (never spanning the gutter), the exact 200/206 × 285/291 proportion, the 15 mm safe box strictly inside it, resolution-independence at any width, and inertness — `pointer-events-none`, `aria-hidden`, no id, no interactive element, nothing persistable |

## What is deliberately NOT here

- **The builder canvas itself.** The two builder test files above cover the model, the
  persistence boundary and the render geometry — which is where the page-to-page photo migration
  actually lived — but not the gestures on top of them. `_block.tsx`, `_use-builder.ts`,
  `_use-cover.ts`, `_use-photo-edits.ts` and `_use-edit-history.ts` are client components and
  hooks behind an authenticated route; asserting on them needs a DOM harness this suite does not
  have, and a signed-in session it cannot create. Drag-to-place, the in-canvas crop gesture, the
  adjustment ghost, undo ordering across the two history lanes and the cover toolbars were
  verified by static analysis and by typecheck/build, NOT by driving the app.

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

- **The generated PDF's actual bytes.** The print tests assert the geometry the renderer *emits* —
  the `@page` size in exact millimetres, the fragmentainer-rounded page element, the panel
  construction, the page count and order — and `print-spec.test.ts` asserts both MediaBoxes in
  points. They do NOT open a produced file: that needs headless Chromium, which this suite
  deliberately does not launch (the worker suite owns the render pipeline, with a fake renderer).
  **So the first file of each kind must be opened in a PDF reader and checked** for page size,
  fold positions, spine width, bleed, blank wrap and page order. See the manual prepress list in
  the print-export section of `CLAUDE.md`.

- **Colour space and total ink.** Nothing here asserts CMYK or a 300 % TAC, because nothing
  produces them: Chromium emits DeviceRGB, and no approved ICC profile exists in this repository.
  A test that passed would be asserting a claim the artifact does not support. The conversion is
  a documented, unimplemented post-process — see `CLAUDE.md`.

## Fixtures

There are none: every test in this suite is pure. **If a future test needs database fixtures it
must follow the mandatory procedure in CLAUDE.md → *Destructive operations & test data*** —
explicit ids, an external manifest, a pre-mutation fingerprint, exact-PK deletion, an ownership
re-check immediately before deleting, and a post-run fingerprint comparison. Never clean up by
pattern, name, email or timestamp.
