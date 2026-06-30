# Malnad Stories — UI/UX Refinement Audit

> **Guarantee.** Analysis only. No backend touched. Every recommendation below is a
> **frontend presentation change** that preserves existing functionality, data flow, and
> server contracts. Where an idea would require a server/schema/endpoint change, it is
> labelled **"Backend Change Required – Not Included"** and not pursued.
>
> **Method.** Findings are grounded in the actual files, not the spec: `login/page.tsx`,
> `_auth-shell.tsx`, `dashboard/page.tsx`, `_library.tsx`, `_album-card.tsx`,
> `albums/new/_wizard.tsx`, `albums/[id]/build/_builder.tsx`, `_tray-toolbar.tsx`,
> `_navigator.tsx`, `checkout/[albumId]/_checkout.tsx`, `admin/page.tsx`, `admin/_nav.tsx`.
>
> **Design direction applied.** Minimal · clean · premium · low cognitive load. Palette =
> white + logo green + existing neutrals only. No new accents, no new gradients, restraint
> on glass/blur. **Homepage is explicitly out of scope** and not analysed.

---

## 0. Cross-cutting findings (apply to several screens)

These recurring issues are listed once here and referenced by screen below, so each screen
section stays short.

### 0.1 Hardcoded hex/HSL instead of design tokens — **the #1 consistency risk**
The token system in `globals.css` (`--primary`, `--gold`, `--muted-foreground`, …) is
excellent, but many screens bypass it with literal colors that are *copies* of those
tokens:
- `_library.tsx` resume banner: `bg-[#1e3a2f]`, `text-[#f5efe3]`, `text-[#8aa395]`, `bg-[#ecd9ad]`
- `_wizard.tsx` cinematic veil: `bg-[#122019]`, `text-[#b89a5c]`, `#ecd9ad`
- `_nav.tsx` admin rail: `bg-[#16271f]`, `text-[#a9bdb0]`, `text-[#5f7d6e]`, `border-[#ecd9ad]`
- `_navigator.tsx`: `border-[#ecd9ad]`; `_album-card.tsx` spine: inline `hsl(160 28% 12%)` etc.
- `admin/page.tsx` + builder review banner: Tailwind defaults `text-amber-600` / `bg-amber-500/5`
  instead of the brand `--warning` token.

**Why it matters:** literals can't track the palette and **don't adapt to dark mode** (the
`.dark` block only re-maps the CSS variables). This is the single biggest threat to the
"visual consistency / use only the existing palette" goal. **Fix (frontend-only):** replace
literals with the semantic token classes that already encode those exact values
(`bg-primary`, `text-primary-foreground`, `text-gold`, `text-warning`, …).

### 0.2 The gold accent is over-used
The token's own comment calls gold *"a whisper, reserved for the rarest highlights."* In
practice it appears as a routine secondary accent: dashboard date eyebrow + search icon,
checkout eyebrows + Truck icons + "Edit" links, wizard chapter checkmarks. The client asked
to **avoid additional accent colors** — gold reads as a second accent today. **Fix:** keep
green as the single accent; demote gold to truly rare moments (e.g. one completion/seal
flourish). Net effect is calmer and more premium.

### 0.3 Stacked glass / backdrop-blur vs. the "minimal" brief
Sticky headers (`bg-background/85 backdrop-blur-md`), the frosted `builder-panel`, and the
dark `builder-glass` navigator layer multiple blur surfaces. The client explicitly wants to
**avoid heavy glassmorphism**. **Fix:** keep one quiet elevation language — solid or near-solid
surfaces with a hairline border and a soft shadow; reserve blur for true overlays (modals),
not for persistent chrome.

### 0.4 Two radius languages used ad hoc
`--radius` is `2px` ("crisp editorial corners"), yet cards/inputs widely use `rounded-xl`/
`rounded-2xl` (12–16px). Both can coexist, but today the choice looks incidental (e.g. raw
search inputs are square while neighbouring cards are 16px). **Fix:** make it a rule —
*editorial 2px for chrome/inputs, soft 16px for content cards* — and apply consistently.

### 0.5 Touch & accessibility hygiene
- **Hover-only controls:** the album delete button (`opacity-0 group-hover:opacity-100`) is
  invisible on touch. Make destructive/secondary affordances reachable on touch (always-on at
  low emphasis, or a kebab menu) with ≥44px targets.
- **Error announcing:** form errors render as a plain `<p>` (e.g. login, checkout). Add
  `role="alert"`/`aria-live="polite"` so screen readers announce them.
- **Custom modals:** the delete-confirm dialogs in `_library.tsx`/`_album-card.tsx` close on
  backdrop click but have no Escape-key handler or focus trap. Add both.

### 0.6 Orphaned component (housekeeping)
`dashboard/_album-card.tsx` is **imported nowhere** — the live dashboard renders `ShelfBook`
from `_library.tsx`. Two different album-card visual languages exist in the tree. Confirm the
shelf is canonical and retire the orphan to prevent future drift. *(Verify before deleting.)*

---

## 1. Login (`(auth)/login/page.tsx`, `_auth-shell.tsx`)

### Keep As-Is
- The `AuthShell` editorial frame (Sprig mark, uppercase eyebrow, Fraunces display title, one
  centered card on the warm surface) — calm, premium, on-brand. **Don't touch.**
- Single-column form, logical order, inline **Forgot?** beside the password label,
  **Stay logged in** checked by default, full-width submit with pending state.
- Mobile: `max-w-md` + `p-4` is already responsive and comfortable.

### Improve
- **Error feedback:** the single `text-destructive` line should become an `role="alert"`
  block with a small icon, so it's noticed and announced (0.5).
- **Password field:** add a show/hide toggle — standard, reduces failed logins, frontend-only.
- **Submit affordance:** keep one primary; ensure the focus-visible ring is obvious on the
  dark green button.

### Simplify
- Nothing structural — this screen is already minimal. Resist adding social-login chrome or
  marketing; its restraint is a strength.

### Proposed UI changes (frontend-only)
- Wrap the error in an alert region with icon; add password visibility toggle; verify the
  focus ring on inputs/button meets the 3:1 UI-contrast bar on the cream surface.

### Impact
- **Usability/confidence:** clearer error + password peek reduce sign-in failures and retries.
- **Accessibility:** announced errors and visible focus help keyboard/AT users.
- **Speed:** fewer mistyped-password retries.

---

## 2. User Dashboard (`dashboard/page.tsx`, `_library.tsx`)

### Keep As-Is
- The **shelf metaphor** (book spines, "New story" bookend) — distinctive and premium.
- **Continue where you left off** resume banner — excellent for returning users.
- Search + year + **status chips**, plus the strong **empty / no-match** state with a
  one-tap *Clear filters*. Good information scent.

### UX issues
- **Top-heavy masthead:** a gold date eyebrow + a `3.2rem` "Good evening." + a subtitle push
  the actual albums well down the page, especially on mobile. High ceremony, low utility.
- **Vocabulary mismatch:** the filter chip says *"In progress"* but the same state's badge
  says *"Draft"* (`KIND.draft.label`). One concept, two words.
- **Raw inputs:** the search `<input>` and year `<select>` are hand-styled (square, custom
  borders) rather than the shared `Input` component → inconsistent with the rest of the app.
- **Hover-only delete** (0.5) and **hardcoded greens** in the resume banner (0.1).

### Improve
- Compress the masthead (smaller greeting, drop or shrink the gold date line) so the shelf is
  closer to the fold. Unify the chip/badge label ("In progress" everywhere, or "Draft"
  everywhere). Route the search/year through the shared input components.

### Simplify
- One status vocabulary; one input style; less vertical preamble. The resume banner already
  answers "what next?" — let it and the shelf dominate.

### Proposed UI changes (frontend-only)
- Tokenize the resume banner (`bg-primary`/`text-primary-foreground`/…); reduce masthead
  scale; reconcile chip vs badge copy; always-visible (low-emphasis) delete on touch with a
  focus trap + Escape in the confirm dialog.

### Impact
- **Speed:** albums visible sooner → faster re-entry to building/ordering.
- **Confidence/consistency:** one status language and one input style read as a single, polished product.
- **Conversion:** a tighter "Ready to order" path to checkout from the shelf.

---

## 3. Album Creation Flow (`albums/new/_wizard.tsx`)

### Keep As-Is
- The **four-chapter narrative** (Begin → Format → Memories → Review) with a jump-back
  stepper and **Save & exit** — calm and guided.
- **Build it for me** (deterministic auto-layout previewed before saving) — a genuine
  differentiator; keep it prominent.
- The **Review** recap (album facts + "the numbers") builds confidence before the builder.

### UX issues
- **Step 0 overload:** *Begin* shows four fields (title + destination + date range +
  description) when only the **title** is required. Four inputs on the first screen raises
  cognitive load against the "low cognitive load" goal.
- **Misleading copy:** *"You can add or remove pages any time while building"* sits under the
  size picker, but **size/cover lock at creation** (the `locked` notice even says so). The two
  messages conflict.
- **Forced 1.7s veil:** entering the builder always waits on a `setTimeout(…, 1700)` cinematic
  veil (twice — after Build-it-for-me and after Review). Beautiful once; friction on every run.
- **Gold + hardcoded veil hexes** (0.1, 0.2).

### Improve
- Progressive disclosure on *Begin*: title prominent; collapse destination/dates/description
  behind a quiet **"Add trip details (optional)"** toggle.
- Fix the page-count copy to match reality (size is chosen here; *layouts/photos* are flexible
  later).

### Simplify
- Make the entry veil **skippable** (click/key to proceed) or shorten to ~600–800ms so repeat
  creators aren't taxed.

### Proposed UI changes (frontend-only)
- Optional-fields disclosure on step 0; corrected size copy; skippable/shortened veil;
  tokenized veil colors; lighter gold.

### Impact
- **Speed of completion:** fewer fields up front + skippable veil = faster first album.
- **Confidence:** honest copy about what's fixed vs. editable avoids second-guessing.
- **Low cognitive load:** the first screen asks for one thing, not four.

---

## 4. Album Builder (`_builder.tsx`, `_tray-toolbar.tsx`, `_navigator.tsx`)

### Keep As-Is
- **Undo/redo**, the **Saved/Unsaved** pill, the **page-budget meter**, **keyboard
  shortcuts**, the **worker-readiness gate**, and the WYSIWYG editor/preview parity — these are
  real strengths; do not remove capability.
- The **bottom thumbnail Navigator** (click-to-focus, drag-to-reorder) is a strong mental model.
- The **Photo Library** panel with search + status chips (`_tray-toolbar.tsx`) and *Remove unused*.

### UX issues
- **Toolbar overload:** the top-right cluster carries ~11 controls — `[Undo][Redo] | [Guides]
  [Shortcuts]`, **Assistant**, **Layouts**, `[Edit|Preview]`, `[Focus|All]`, **Save**,
  **Submit**, **Checkout** — plus Add-page controls and the cover chip below. That's a lot to
  parse, especially on first visit.
- **Two overlapping "layout" entry points:** **Assistant** (auto-lay the whole album) and
  **Layouts** (apply a preset to the focused spread) are different actions with adjacent names
  and the same `Wand2`/`LayoutTemplate` semantics — easy to confuse.
- **Competing primaries:** when an album is `submitted`, both **Submit** and **Checkout** render
  with the primary `LUX_PRIMARY` treatment → two emphasised CTAs (the design rule is one).
- **Two atmospheres + glass (0.3):** a bright frosted `builder-panel` beside a dark
  `builder-glass` navigator on one screen runs against the minimal direction.
- **Discoverability of "Add page":** the page-budget meter says *"cover & blanks added
  automatically,"* but how a user adds a Single/Double spread isn't obvious from the top bar.

### Improve
- Group the toolbar into three calm clusters: **(1) view** `Edit | Preview`; **(2) one Layout
  entry** that contains both auto-layout (Assistant) and presets (Layouts) as labelled options;
  **(3) commit** — rely on the existing auto **Saved/Unsaved** pill and show a single
  context-aware primary (**Submit**, then **Checkout** once submitted). Demote Undo/Redo/Guides/
  Shortcuts/Focus-All to a quiet secondary row or an overflow "⋯ Tools" menu.
- Make **Add Single/Double Page** a clear, consistent affordance near the canvas/meter.

### Simplify
- **One primary at a time.** After submit, Submit becomes a quiet secondary and Checkout is the
  sole primary.
- **One layout door**, not two. Reduce the perceived tool count without removing any tool.
- Soften the dark glass navigator toward a calmer solid surface (0.3).

### Proposed UI changes (frontend-only)
- Re-cluster the toolbar; merge the two layout entries under one labelled control; single
  context primary; overflow menu for power tools; tokenize the navigator's `#ecd9ad`
  highlight; reduce blur layering. **No capability removed** — everything stays reachable.

### Impact
- **Usability:** a 3-cluster toolbar is scannable; novices find "lay out my album" in one place.
- **Confidence:** one clear next action (Submit → Checkout) removes "which button?" hesitation.
- **Premium feel:** calmer chrome lets the photos/pages be the hero (the stated goal).

---

## 5. Checkout (`checkout/[albumId]/_checkout.tsx`)

### Keep As-Is
- The **persistent order rail** (cover, coupon, live server-priced total, est. delivery) — keep
  it; it's the trust anchor.
- **Trust/confidence signals**: header *Secure* lock, the Razorpay reassurance bullets, *"You
  won't be charged until you confirm,"* the **Cancel** escape, and the **cinematic success**
  screen. Payment confidence is genuinely strong.
- **Server-computed amounts** + coupon preview + copies stepper + **Edit** links from Review.

### UX issues
- **Six steps for one item:** `ready → summary → shipping → delivery → payment → review` (then
  the Razorpay modal). That's long for a single album.
- **The Payment step has no input** — it's three reassurance bullets occupying a whole step
  before Review. Pure friction.
- **The Ready (readiness) step gates the flow** before the user sees price/summary; it's
  advisory, so it doesn't need to be the first wall.
- **No price context on step 1:** the rail only appears from `summary` onward (`showRail =
  curIdx >= 1`), so the first screen has no total.
- **Mobile total isn't sticky:** the rail stacks below on mobile, so the running total scrolls
  away. Gold "Edit" links (0.2); the Review *Coupon* edit jumps to `summary` though coupon
  lives in the rail.

### Improve
- Fold **Payment** reassurance into the **Review** step (or the rail) — delete it as a step.
- Turn **Ready** into an advisory banner on **Summary** (keep the checks, lose the wall).
- Combine **Shipping (address)** and **Delivery (tier)** onto one "Where & how" screen — they're
  both "getting it to you."
- Show the order rail/total from the first visible step.

### Simplify
- Target **~3 steps**: **Summary (+readiness banner) → Address & Delivery → Review & Pay**, with
  the rail visible throughout. Same data, same server calls, fewer walls.
- Add a **sticky mobile total bar** so price is always in view.

### Proposed UI changes (frontend-only)
- Merge/relocate steps as above (all step logic is client state in `_checkout.tsx` — no server
  change); sticky mobile summary; tokenize the gold "Edit" links; point the Review *Coupon* edit
  at where the coupon field actually lives.

### Impact
- **Conversion:** fewer steps + always-visible total + no dead "Payment" wall reduce drop-off.
- **Confidence:** readiness as a calm banner (not a gate) keeps momentum while still informing.
- **Speed:** 3 screens to pay instead of 6.

---

## 6. Admin Dashboard (`admin/page.tsx`, `admin/_nav.tsx`)

### Keep As-Is
- The deliberately **utilitarian** treatment (compact cards, dense tables) — correct for a
  back-office; don't "consumer-ify" it.
- **KPI grid → live queue → needs-attention → recent orders**, each linking to its drill-down.
  Good operational hierarchy.
- The **grouped, RBAC-filtered left rail** with icon-only collapse on small screens.

### UX issues
- **Non-token alert colors:** `text-amber-600` / `bg-amber-500/5` instead of the brand
  `--warning` token (0.1) — visible inconsistency with the rest of the console.
- **No search anywhere on the surface:** with ~22 nav items and order/customer lookups being the
  core job, the absence of a quick find is the main efficiency gap.
- **Table polish:** the recent-orders table has hover but no sticky header / zebra; raw status
  string (`{r.status}`) rather than the friendlier `adminStatusLabel` used in the queue.
- **Cross-app type drift:** admin uses `text-xl font-bold` where the customer app uses
  `font-display` — minor, but worth a deliberate decision.

### Improve
- Tokenize alert colors to `--warning`/`--destructive`. Give tables a sticky header + subtle row
  separation; render the order status via the existing label/chip helper for consistency.
- Add a lightweight **filter/search on the orders surface** (the orders list already supports
  `?status=` deep links — extend with client-side text filtering over already-loaded rows).

### Simplify
- The 7-group rail is long; consider a "Pinned"/most-used cluster at top (Orders, Production,
  Support) so daily tasks aren't a scroll away — pure nav reordering, no route change.

### Proposed UI changes (frontend-only)
- Token alerts; sticky/zebra tables; consistent status chips; client-side order search; an
  optional pinned-nav cluster.

### Impact
- **Workflow efficiency:** find an order/customer in seconds; less scrolling.
- **Consistency:** brand-token alerts and one status vocabulary across admin.
- **Speed:** sticky headers + quick filter speed the highest-frequency tasks.

> **Backend Change Required – Not Included:** a *global* admin command palette (⌘K) that
> searches across orders, customers, and albums efficiently would want a dedicated search
> endpoint/index. The **client-side filter over already-loaded rows** above is the frontend-only
> version and is what's recommended here.

---

## Summary — highest-leverage, lowest-risk changes

| Priority | Change | Screens | Risk |
|---|---|---|---|
| 1 | Replace hardcoded hex with semantic tokens (+ dark-mode correctness) | all | very low |
| 2 | Collapse checkout 6 → ~3 steps (drop dead Payment step; readiness as banner; merge address+delivery) | checkout | low |
| 3 | Re-cluster builder toolbar to 3 groups + one layout entry + single context primary | builder | low |
| 4 | Rein in gold to a rare highlight; reduce stacked glass/blur | all | very low |
| 5 | Compress dashboard masthead; unify status vocabulary; shared inputs | dashboard | very low |
| 6 | Touch/a11y pass (visible touch controls, alert roles, modal focus trap/Escape) | all | low |
| 7 | Admin: token alerts, sticky/zebra tables, client-side order search | admin | low |
| 8 | Wizard: optional-fields disclosure, corrected copy, skippable veil | creation | low |

**All recommendations are frontend-only, remove no functionality, and keep the backend 100%
untouched.** Nothing here changes APIs, server actions, route handlers, schemas, auth,
payments, email, storage, or admin permissions.
