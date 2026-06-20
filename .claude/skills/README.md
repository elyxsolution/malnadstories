# Design skills — Malnad Stories

Three project-level Claude Code skills that encode this project's design standards.
Claude Code auto-discovers any `SKILL.md` under `.claude/skills/*/` and exposes it to
the model based on its `description`. These apply to **all** UI/UX/frontend/component/
layout/animation/branding/design work (see the "Design standards" section in the
repo-root `CLAUDE.md`).

| Skill (dir) | Purpose | Key reference |
|---|---|---|
| `impeccable-design/` | Systematic visual rigor: spacing, typography, color, hierarchy, layout, component states, tokens. | `references/design-tokens.md` |
| `emil-kowalski-design-engineering/` | Motion & interaction craft: timing, easing, gestures, micro-interactions, motion a11y. | `references/motion-recipes.md` |
| `taste/` | Design judgment: restraint, cohesion, avoiding generic/AI UI, premium direction & final review. | — |

## How they're invoked

- **Automatically (model-driven):** each `SKILL.md` has a `description` listing its
  triggers. When a task matches (building a component, animating something, polishing a
  layout, branding, etc.), the model loads and applies the relevant skill. `CLAUDE.md`
  also instructs the assistant to apply them on all design work without being asked.
- **Explicitly:** invoke by name with the Skill tool / slash command, e.g. the model
  calls the `taste`, `impeccable-design`, or `emil-kowalski-design-engineering` skill.

## Typical flow

`taste` (direction) → `impeccable-design` (static execution) → `emil-kowalski-design-engineering`
(motion/interaction) → `taste` (final gut-check). Each skill ends with a review checklist;
run it before considering UI complete.

## Authoring notes

- These were created manually — none of the three is published in the official Claude
  plugins marketplace or any package registry (verified against the 394-plugin
  `anthropics/claude-plugins-official` catalog). If official versions ship later, install
  via the marketplace and reconcile.
- Frontmatter `name` matches the directory name (lowercase-with-hyphens), required for
  discovery. Keep `SKILL.md` focused; push long detail into `references/`.
