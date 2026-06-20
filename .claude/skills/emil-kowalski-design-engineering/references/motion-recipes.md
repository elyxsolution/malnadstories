# Motion recipes (copy-ready)

Stack-aware: this project uses Tailwind v3 + React 18 + Next.js 14. No motion library
is installed by default — prefer CSS/Tailwind first; reach for `framer-motion` only when
you need gesture/spring/layout animation, and confirm before adding a dependency.

## 1. Press state (the highest-leverage micro-interaction)

Tailwind, zero JS:

```tsx
<button className="transition-transform duration-100 ease-out active:scale-[0.97]">
  Click me
</button>
```

Add a hover lift for cards:

```tsx
<div className="transition-[transform,box-shadow] duration-200 ease-out
                hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0">
```

## 2. Origin-aware popover / menu enter (CSS)

```css
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
.popover {
  transform-origin: var(--radix-popover-content-transform-origin, top center);
  animation: pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

With @base-ui/react (this project's shadcn dep), use the component's exposed
transform-origin CSS var or `data-side`/`data-starting-style` attributes to drive enter/exit.

## 3. Tailwind keyframes for enter/exit (tailwind.config.ts)

```ts
extend: {
  keyframes: {
    'fade-in':   { from: { opacity: '0', transform: 'translateY(4px)' },
                   to:   { opacity: '1', transform: 'translateY(0)' } },
    'fade-out':  { from: { opacity: '1' }, to: { opacity: '0' } },
  },
  animation: {
    'fade-in':  'fade-in 200ms cubic-bezier(0.16,1,0.3,1)',
    'fade-out': 'fade-out 130ms ease-in', // exit faster than enter
  },
}
```

## 4. Accordion / height reveal without animating `height`

```css
.reveal { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 250ms ease-out; }
.reveal[data-open] { grid-template-rows: 1fr; }
.reveal > div { overflow: hidden; }
```

## 5. Framer Motion — interruptible spring drawer (only if framer-motion added)

```tsx
<motion.div
  drag="y"
  dragConstraints={{ top: 0, bottom: 0 }}
  dragElastic={0.2}                       // rubber-band past edge
  onDragEnd={(_, info) => {
    if (info.velocity.y > 500 || info.offset.y > 120) onClose();
  }}
  initial={{ y: '100%' }}
  animate={{ y: 0 }}
  exit={{ y: '100%' }}
  transition={{ type: 'spring', stiffness: 400, damping: 40 }} // no overshoot, interruptible
/>
```

## 6. prefers-reduced-motion (always include)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Or scoped, the correct way (keep opacity, drop movement):

```tsx
const reduce = useReducedMotion(); // framer-motion hook
transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 40 }}
```

## 7. Loading: delay before spinner, skeleton preferred

```tsx
// Don't flash a spinner for fast responses
const [showSpinner, setShowSpinner] = useState(false);
useEffect(() => { const t = setTimeout(() => setShowSpinner(true), 300); return () => clearTimeout(t); }, []);
```

## Numbers to memorize

- Hover/press: 100–150ms, ease-out
- Small state: 150–200ms, ease-out
- Dialog/drawer: 250–350ms, spring (stiffness ~400, damping ~40)
- Exit = ~⅔ of enter, ease-in
- Enter ease: `cubic-bezier(0.16, 1, 0.3, 1)`
- Only animate `transform` + `opacity`
