# Design tokens & scales (reference)

Concrete, reusable values. This project already uses CSS-variable tokens in
`src/app/globals.css` consumed by `tailwind.config.ts`. Extend that system — do not
introduce a parallel one or hardcode hex in components.

## Spacing scale (4px base — Tailwind default)
```
0  4  8  12  16  20  24  32  40  48  64  80  96  128
px equivalents: 1=4px, 2=8px, 3=12px, 4=16px, 6=24px, 8=32px, 12=48px, 16=64px
```
Rule of thumb:
- label→input: `gap-1`/`gap-2` (4–8px)
- field→field: `gap-4`/`gap-6` (16–24px)
- section→section: `gap-12`/`gap-16` (48–64px)
- card padding: `p-4` to `p-6` (16–24px); generous on marketing surfaces

## Type scale (1.25 minor-third)
| Token | size / line-height | use |
|---|---|---|
| xs   | 12 / 16  | captions, badges, table meta |
| sm   | 14 / 20  | secondary body, dense UI, labels |
| base | 16 / 24  | body |
| lg   | 18 / 28  | lead paragraph |
| xl   | 20 / 28  | card titles, section labels |
| 2xl  | 24 / 32  | page section headings |
| 3xl  | 30 / 36  | page titles |
| 4xl+ | 36+ / 1.1| hero |

Weights: 400 (body), 500 (UI labels/buttons), 600 (headings/emphasis). Avoid 700+
except very large display.
Tracking: headings `tracking-tight` (-0.02em); caps labels `tracking-wide`.
Numerics in tables/prices: `tabular-nums`.

## Color token structure (semantic, not raw)
```
--background / --foreground
--card / --card-foreground
--muted / --muted-foreground      (secondary text, subtle fills)
--border / --input / --ring
--primary / --primary-foreground  (the single accent)
--destructive / --destructive-foreground
--success --warning               (status; muted, not neon)
```
- Mostly neutrals; one accent. Status colors used only for status, never decoration.
- Borders: `hsl(var(--border))` ≈ 6–10% foreground over background.

## Radius scale
```
sm: 4px   md: 6–8px   lg: 12px   xl: 16px   full: 9999px
```
Nested radius rule: `inner = outer − gap`. A 12px card with 8px inner padding → inner
element radius ~4–6px.

## Elevation (layered soft shadows)
```
sm:  0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.03)
md:  0 2px 4px rgba(0,0,0,0.05), 0 4px 8px rgba(0,0,0,0.04)
lg:  0 4px 8px rgba(0,0,0,0.05), 0 12px 24px rgba(0,0,0,0.06)
xl:  0 8px 16px rgba(0,0,0,0.06), 0 24px 48px rgba(0,0,0,0.08)  (modals)
```
Never a single hard dark shadow. Reserve xl for the topmost layer only.

## Breakpoints (mobile-first)
```
default → mobile  | sm 640 | md 768 | lg 1024 | xl 1280 | 2xl 1536
```
Write base styles for mobile; add `sm:`/`md:`/`lg:` to enhance upward.

## Component state matrix (must all exist)
default · hover · active/pressed · focus-visible · disabled · loading · error · selected · empty
