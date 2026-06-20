---
name: emil-kowalski-design-engineering
description: >-
  Design-engineering craft for motion, interaction, and feel — based on Emil
  Kowalski's principles (creator of Sonner, Vaul, and the "Animations on the
  Web" course). Use whenever building or refining animations, transitions,
  gestures, micro-interactions, toasts, dialogs, drawers, hover/press states,
  loading/optimistic UI, or any moment where the interface should feel fast,
  physical, and intentional. Apply on UI, frontend, component, and animation tasks.
---

# Emil Kowalski — Design Engineering

The discipline of making interfaces *feel* right. Motion is not decoration; it is
communication. Every animation either clarifies a change of state or it is noise.
When in doubt, remove it. When you keep it, make it fast, interruptible, and physical.

## The core philosophy

1. **Animation must have a purpose.** It either (a) shows where something came from
   or went to, (b) directs attention, (c) communicates state, or (d) expresses brand
   personality at a deliberate moment. If it does none of these, delete it.
2. **The best animation is invisible.** Users should feel that the UI is responsive
   and alive, not watch a show. If someone notices "nice animation," it is often too
   slow or too big.
3. **Speed is a feature.** Faster than you think. Most UI transitions should land in
   **150–300ms**. Hover/press feedback: **100–150ms**. Anything over ~400ms for a
   functional transition feels sluggish on repeat use.
4. **Interruptibility.** Real interfaces are interrupted constantly. Animations must be
   re-targetable mid-flight (use spring/physics or `transition` that the engine can
   redirect), never queued or locked.

## Timing & easing — the defaults

| Interaction | Duration | Easing |
|---|---|---|
| Hover / press feedback | 100–150ms | `ease-out` |
| Toggle, checkbox, small state | 150–200ms | `ease-out` |
| Dropdown, popover, tooltip enter | 150–200ms | `ease-out` |
| Dialog / drawer / sheet | 250–350ms | spring or custom `cubic-bezier` |
| Page / view transition | 300–400ms | ease-in-out |
| Exit animations | **faster than enter** (~⅔) | `ease-in` |

- **Enter with `ease-out`** (decelerate — content arrives and settles). **Exit with
  `ease-in`** (accelerate away — get out of the way quickly).
- Prefer **spring physics** for anything draggable or gesture-driven (drawers, sheets,
  swipe). Springs are naturally interruptible and feel physical. Recommended starting
  point: a spring with moderate stiffness and damping that *just barely* doesn't
  overshoot for functional UI; allow a touch of overshoot only for playful brand moments.
- A reliable custom ease for enters: `cubic-bezier(0.16, 1, 0.3, 1)` (strong decel).

## What to animate — and what NOT to

**Animate (cheap, GPU-composited):** `transform` (translate/scale/rotate) and `opacity`.
These run on the compositor and stay at 60fps.

**Avoid animating (causes layout/paint):** `width`, `height`, `top`, `left`, `margin`,
`padding`, `box-shadow` on large surfaces. Use `transform: scale()` instead of width/height,
animate a pseudo-element or layered shadow instead of `box-shadow`, use `transform:
translate()` instead of `top/left`. For size changes that must reflow, prefer a FLIP
technique or a height-from/`grid-template-rows: 0fr→1fr` trick rather than animating layout.

## Micro-interaction craft

- **Press states matter most.** A button that scales to ~0.97–0.98 on `:active` with a
  100ms ease feels responsive and physical. This single detail separates premium from generic.
- **Origin-aware motion.** Popovers, menus, and tooltips should scale/fade *from the
  element that opened them* (`transform-origin` at the trigger), not from center. This
  makes the spatial relationship obvious.
- **Optimistic UI.** Reflect the user's action instantly (local state) and reconcile with
  the server afterward. Never block the UI behind a spinner for an action the user expects
  to succeed.
- **Loading.** Prefer skeletons that match final layout over spinners. For sub-300ms waits,
  show nothing (a flash of spinner is worse than no spinner). Use a delay before showing
  any loading indicator.
- **Stagger sparingly.** Staggered list entrances (20–40ms apart) feel premium on first
  paint but become annoying on every re-render. Animate on mount only, not on updates.

## Gestures & drawers (the Vaul/Sonner lessons)

- Draggable surfaces follow the finger 1:1 within bounds, with **rubber-band resistance**
  past the edge. Release velocity decides commit vs. snap-back (velocity threshold, not
  just position).
- Toasts: enter from the edge, **swipe-to-dismiss** with the gesture, auto-dismiss timers
  that **pause on hover/focus**, and stack with scale+offset depth. Newest on top.
- Always honor **`prefers-reduced-motion`**: replace movement with a simple opacity fade
  (or no animation), never remove the state change itself.

## Accessibility & performance guardrails

- `@media (prefers-reduced-motion: reduce)` — drop transforms/translations, keep opacity
  or instant state. This is non-negotiable.
- Keep focus management correct through animated transitions (focus trap in dialogs,
  return focus to trigger on close).
- Never animate during scroll on the main thread; use `will-change` only transiently and
  remove it after.
- Test on a mid-tier device / throttled CPU, not just your machine.

## Review checklist (run before calling motion "done")

- [ ] Does every animation have one of the four purposes? Delete the rest.
- [ ] Functional transitions ≤ 300ms; hover/press ≤ 150ms; exits faster than enters.
- [ ] Only `transform` + `opacity` animated (no layout thrash).
- [ ] Press state on every interactive element (scale + fast ease).
- [ ] Popovers/menus scale from their trigger origin.
- [ ] Animations are interruptible (spring or re-targetable), not queued.
- [ ] `prefers-reduced-motion` handled.
- [ ] No spinner for <300ms waits; skeletons match final layout.
- [ ] 60fps on a throttled CPU.

See `references/motion-recipes.md` for copy-ready Framer Motion / CSS / Tailwind snippets.
