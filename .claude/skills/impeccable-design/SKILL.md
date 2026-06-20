---
name: impeccable-design
description: >-
  Systematic visual-design rigor for production interfaces — spacing, typography,
  color, hierarchy, layout, and component states. Use whenever building or polishing
  UI, pages, components, layouts, forms, tables, empty/loading/error states, or design
  systems, and whenever the goal is a premium, production-ready, high-end SaaS look
  (Linear / Stripe / Vercel / Notion quality). Apply on frontend, component, UX,
  layout, and branding tasks to enforce consistency and craftsmanship.
---

# Impeccable Design

Premium interfaces are not the result of one big idea; they are the absence of a
thousand small mistakes. This skill is the checklist of those mistakes. Production
quality means every spacing value, every font size, every border, and every state is
deliberate and drawn from a system — never arbitrary.

## 1. Spacing — the foundation of order

- Use a **single spacing scale** (4px base): 4, 8, 12, 16, 24, 32, 48, 64, 96. No
  magic numbers like `13px` or `27px`. In Tailwind this is the default scale — stay on it.
- **Spacing communicates relationship.** Related elements sit close; unrelated elements
  sit far. The gap *inside* a group must be smaller than the gap *between* groups
  (proximity). A label and its input: 4–8px. Between two form fields: 16–24px.
- **Be generous.** Cramped UI reads as cheap. White space is the cheapest way to look
  expensive. Increase padding before adding borders or backgrounds to separate things.
- **Consistent rhythm.** Vertical spacing between sections should follow the scale and
  repeat. Avoid one-off paddings.
- **Optical alignment over mathematical.** Icons next to text often need a 1px nudge;
  trust the eye.

## 2. Typography — hierarchy through restraint

- **Limit type sizes.** A whole app needs ~5–6 sizes: e.g. 12, 14, 16, 20, 24, 32(+).
  Pick from a scale (e.g. 1.25 ratio), don't invent sizes per component.
- **Two weights do most of the work:** a regular (400/450) and a medium/semibold
  (500/600). Use weight, not size, to create hierarchy within a block.
- **Line height scales inversely with size.** Body text 1.5–1.6; headings 1.1–1.25.
  Tight leading on large text, loose on small.
- **Line length** 45–75 characters for readable paragraphs (`max-w-prose` / ~65ch).
- **Contrast through hierarchy, not just size:** primary text near-black, secondary
  text a muted gray, tertiary lighter still. Use a small set of text colors (e.g.
  foreground / muted-foreground), not random grays.
- **Tracking:** slightly negative letter-spacing on large headings (-0.01 to -0.02em);
  default on body; slightly positive on ALL-CAPS labels.
- **Numbers:** use tabular figures (`font-variant-numeric: tabular-nums`) in tables,
  prices, and anything that aligns in columns. Critical for an INR-priced commerce app.

## 3. Color — calm, purposeful, accessible

- **Neutral-dominant.** A premium UI is mostly grayscale with one accent used sparingly.
  Color earns attention; if everything is colorful, nothing stands out.
- **Define semantic tokens, not raw hex in components:** `background`, `foreground`,
  `muted`, `muted-foreground`, `border`, `primary`, `destructive`, `success`, `warning`.
  Reference tokens everywhere (this project already uses CSS-var tokens in globals.css
  + tailwind.config — extend that, never hardcode).
- **Borders are barely-there.** Use low-contrast borders (a few % of foreground over
  background). Heavy black borders look unfinished. Often a subtle background shift
  separates regions better than a border.
- **Shadows are soft and layered.** One realistic shadow = multiple stacked low-opacity
  shadows (ambient + direct), never a single hard `0 4px 8px rgba(0,0,0,0.5)`. Elevation
  should be subtle; reserve the strongest shadow for the highest layer (modals).
- **Contrast ratios:** body text ≥ 4.5:1, large text/UI ≥ 3:1. Check muted-foreground
  against its real background, not white.

## 4. Visual hierarchy — guide the eye

- Every screen has **one** primary action. Make it the most prominent element (filled,
  accent). Secondary actions are quieter (outline/ghost). Tertiary are text links.
  Never two competing primary buttons.
- Establish hierarchy with, in order of preference: **size → weight → color → spacing**.
  Reach for size and weight before adding more color.
- **Scan path:** users read top-left → down. Put the most important thing where the eye
  lands. Group and order by importance, not by data-model convenience.

## 5. Layout & alignment

- **Everything aligns to a grid.** Establish a max content width and consistent gutters.
  Left edges of stacked elements share an alignment line.
- **Avoid center-aligning long text;** center only short, symmetrical content (hero
  headlines, empty states).
- **Container queries / responsive:** design mobile-first (see standards), then enhance.
- **Density appropriate to context:** dashboards/tables denser; marketing/onboarding airier.

## 6. Components must cover every state

A component is not done until all states exist and are designed:

- **default, hover, active/pressed, focus-visible, disabled, loading, error, selected.**
- **Empty state** — never show a blank area. Explain what goes here + a primary action.
- **Loading state** — skeletons matching final layout (not spinners) for content.
- **Error state** — human message, the cause if known, and a recovery action.
- **Focus** — visible `focus-visible` ring on every interactive element (keyboard users).
  Never `outline: none` without a replacement.
- **Long content / overflow** — truncate with ellipsis + title, or wrap gracefully. Test
  with the longest realistic string and the emptiest.

## 7. Details that signal craft

- Consistent **border-radius** scale; nested radii follow the rule `inner = outer −
  padding`. Mismatched radii look broken.
- **Icons** from one set (this project: lucide-react), consistent stroke width and size,
  optically centered, vertically aligned to adjacent text.
- **Hit targets** ≥ 44×44px on touch.
- **Transitions** on interactive states (see the Emil Kowalski skill for motion).
- Align number/currency columns; right-align numerics in tables.
- No orphaned pixels: check 1px misalignments, inconsistent gaps, and off-scale values.

## Review checklist (run before calling a UI "done")

- [ ] All spacing on the 4px scale; inside-group gaps < between-group gaps.
- [ ] ≤ 6 type sizes, ≤ 2–3 weights, ≤ 3 text colors; tabular figures where aligned.
- [ ] Neutral-dominant palette, one accent, semantic tokens (no raw hex in components).
- [ ] Borders subtle; shadows soft/layered; consistent radius scale (nested radii correct).
- [ ] Exactly one primary action per view; hierarchy via size/weight before color.
- [ ] Every interactive element has hover, focus-visible, active, disabled.
- [ ] Empty, loading (skeleton), and error states designed — no blank/spinner-only areas.
- [ ] Contrast ≥ 4.5:1 body / 3:1 UI; visible focus rings everywhere.
- [ ] Tested with longest + emptiest realistic content; nothing overflows or misaligns.

See `references/design-tokens.md` for the concrete scales and token structure to reuse.
