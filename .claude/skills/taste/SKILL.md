---
name: taste
description: >-
  Design judgment and editorial restraint — the meta-skill for deciding what makes an
  interface feel premium, distinctive, and human rather than generic or AI-generated.
  Use on any UI, UX, frontend, component, layout, branding, or visual task to set
  direction, make aesthetic trade-offs, avoid template/AI clichés, and pursue
  high-end craft in the spirit of Linear, Stripe, Vercel, Raycast, and Notion.
---

# Taste

Spacing, type, and motion skills tell you *how* to execute. Taste tells you *what to
build and what to leave out*. It is judgment: the ability to look at a screen and feel
what is wrong, then know the smallest change that makes it right. Taste is mostly
subtraction and intention.

## The principles

1. **Restraint is the signal of taste.** The most common failure is doing too much:
   too many colors, gradients, shadows, font sizes, borders, animations. Premium work
   removes until only the essential remains, then makes the essential excellent.
   When unsure, take something away.

2. **Opinion over options.** Generic UI hedges — it offers everything equally. Tasteful
   UI has a point of view: a clear primary action, a confident default, a strong
   hierarchy. Decide for the user.

3. **Cohesion over novelty.** Every element should look like it belongs to the same
   product. One spacing system, one type scale, one motion language, one voice. A
   beautiful component that doesn't match is worse than a plain one that does.

4. **Content first, chrome last.** The user's content/data is the hero. Borders,
   backgrounds, and decoration recede. If chrome competes with content, the chrome loses.

5. **Details compound.** The difference between good and great is fifty 1% details
   nobody can name individually but everyone feels: the press state, the optical
   alignment, the right empty state, the loading skeleton, the copy.

## Reference quality bar

Aim for the feel of **Linear, Stripe, Vercel, Raycast, Notion**. What they share:
- Near-monochrome palettes with one restrained accent.
- Crisp, slightly tight typography; confident hierarchy; generous white space.
- Fast, subtle, purposeful motion — never showy.
- Dense where it's a tool, airy where it's a story; always intentional.
- Keyboard-first, accessible, fast. Performance *is* part of the aesthetic.
- A distinct personality expressed through small, consistent choices — not a theme dump.

## Avoid generic / AI-generated UI tells

These patterns scream "template" or "generated." Actively avoid them:

- **Purple-to-blue / rainbow gradients** as the default brand move. Glowing gradient
  blobs and `bg-gradient-to-r from-purple-500 to-pink-500` everywhere.
- **Emoji as feature icons** (🚀✨🎉) scattered through marketing/UI. Use a real icon set.
- **Three identical feature cards** with an icon-in-a-rounded-square, a bold title, and
  two lines of lorem — the "AI landing page" cliché.
- **Everything centered**, everything the same size, no real hierarchy.
- **Heavy uniform drop shadows** and thick dark borders on every box.
- **Over-rounded** everything (huge border radius on every element) or default unstyled
  square corners.
- **Generic copy:** "Welcome to your dashboard", "Unleash the power of…", "Seamlessly".
  Write specific, human, product-aware text.
- **Inconsistent spacing/sizes** from values picked ad hoc.
- **Animation for its own sake** — bouncy entrances on everything, parallax with no purpose.
- **Default component-library look** with no customization (raw shadcn/Bootstrap defaults
  shipped unedited).

Instead: commit to a restrained palette, real iconography, asymmetric/intentional layout,
specific copy, a coherent motion language, and one memorable detail done well.

## How to apply taste in practice

- **Start from references, not a blank canvas.** Before building, name 1–2 products whose
  feel fits this screen and identify *why* — then adapt the principle, never copy the pixels.
- **Define the personality in one line** before styling ("calm, editorial, trustworthy"
  for a photo-album commerce app), and let every choice ladder up to it.
- **Edit, then edit again.** First make it work, then remove a third of the visual
  elements and see if it got better. It usually does.
- **Earn every addition.** A new color, shadow, font size, or animation must justify
  itself against the existing system. Default to reusing what exists.
- **Sweat the unglamorous states.** Empty, loading, error, and edge-case screens are
  where taste is most visible and most often skipped.
- **Read your own copy aloud.** If it sounds like a template, rewrite it like a person.

## The taste gut-check (ask before shipping)

- [ ] If I removed a third of the visual elements, would it look *better*? (If yes, remove them.)
- [ ] Does this look like it belongs to ONE product, or assembled from parts?
- [ ] Is there exactly one clear primary action, with real hierarchy below it?
- [ ] Does it contain any AI/template tells from the list above?
- [ ] Is the content the hero, or is the chrome shouting?
- [ ] Would Linear/Stripe/Vercel ship this? If not, what one change closes the gap?
- [ ] Are the empty/loading/error states as considered as the happy path?
- [ ] Is there one memorable, intentional detail — and is everything else calm around it?

Taste is the final filter. After the spacing is on-grid (impeccable-design) and the
motion is fast and purposeful (emil-kowalski-design-engineering), taste decides whether
the result is merely correct or genuinely good. Pursue good.
