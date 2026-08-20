# Malnad Stories — 3D Scroll Hero: Design Setup & Build Prompt

## The brief, restated (v2 — full scrollytelling journey)

The concept has changed shape. This is no longer a short flight that hands off into normal page sections — it's now **one continuous journey through the mountains with 4–5 scroll-triggered stops**, each surfacing a piece of the site's actual content, ending at a **cliff edge** rather than floating to a stop near camera.

**Two corrections from the first pass, both reflected below:**
1. **No more "flies in from a distant point."** Reading between the lines, my guess is the far-away entrance (tiny book, fading in from deep in the scene) is what looked weak — that kind of "warp in from nowhere" open often reads cheap. Fix: the book is **already resting in frame at the very first moment**, visible on a trailhead ledge before the user has scrolled at all. The very first scroll input is what lifts it into motion, not a flying entrance. Flag it if I've misread which part didn't land — easy to redirect.
2. **Ends at a cliff, not mid-air.** The journey's final beat is a wide cliff-edge overlook — mist-filled valley below, book comes to rest, CTA appears. A proper destination instead of the book just stopping in open space.

The three original acceptance criteria still stand — carry them through every stop and every transit segment, not just the opening:
1. **Mountains must read as realistic**, not low-poly/gamey.
2. **Leaves fall continuously** as part of the atmosphere.
3. **The book rotates while it travels**, tied to scroll position.

**Stop mapping** — using the full content from your scroll-page doc, nothing trimmed or paraphrased this time. Five content stops plus the cliff finale:

| Stop | Content | Source section |
|---|---|---|
| 1 | Memories That Last · Crafted to Perfection · Trusted by Thousands | Why Choose Us |
| 2 | 1. Choose Your Album 2. Design Your Story 3. Preview & Checkout | How It Works |
| 3 | All 8: AI-Powered Album Design · Drag & Drop Photo Upload · Manual Page Editing · Personalized Text & Stickers · Multiple Album Sizes · High-Quality Printing · Secure Packaging · Fast Delivery Across India — laid out as a compact 2×4 tag grid within the panel rather than trimmed, since it's a glance-read grid, not a paragraph | Premium Features |
| 4 | Premium Quality Materials · Vibrant HD Printing · Handmade Finishing · Secure Payment · Doorstep Delivery | Why You'll Love It |
| Finale (cliff) | "Every album is carefully designed, professionally printed, and handcrafted with attention to every detail — so your memories stay beautiful for generations." → "Ready to Preserve Your Story?" + Create Your Album | Our Promise + closing CTA |

Our Promise now sits right before the CTA at the cliff rather than as its own mid-journey stop — a closing statement leading straight into the call to action reads stronger than splitting them apart.

Customer Reviews stays **outside** the 3D scene — star ratings and testimonial text don't need WebGL, and cramming a sixth stop in stretches an already-long pin further than it needs to. Keep it as a normal DOM section right after the hero releases.

Brand alignment carried over from the design system doc: terrain/lighting map to `#06281F → #0B3D2E → #145A41` (shadow to sunlit foliage), mist to `#DCE8E2`, book cover and warm accents to `#4A2C1D`. Wordmark on the cover uses Cinzel. No colours outside those six anywhere in the scene.

**Worth flagging before you build this:** a 4–5 stop journey is a *long* pinned section — see the vh budget in 1.5. That's a real UX tradeoff (users can bail mid-scroll before reaching the CTA), worth a quick gut-check with the client rather than just building it and finding out. A small progress trail (5 dots/markers showing where they are in the journey) goes a long way toward making a long pin feel intentional instead of endless.

---

## Part 1 — Design & Technical Setup

### 1.1 Stack
- **React (Vite) + TypeScript**
- **React Three Fiber + drei** — R3F for the scene graph, drei for `useGLTF`, `Environment`, `Instances`, `PerspectiveCamera` helpers
- **GSAP + ScrollTrigger** — scroll-scrubbed timeline (not time-based animation; must track scroll position 1:1)
- **@react-three/postprocessing** — Bloom (soft), DepthOfField (subtle, for foreground/background separation), Fog/Vignette for atmosphere
- **Draco/Meshopt-compressed glTF** for models, **KTX2/Basis** for textures

### 1.2 Terrain
"Realistic" mountains at hero-section scale come from **texture and lighting quality**, not polygon count.

- **Path A (recommended if you have any 3D/Blender capacity):** Sculpt a low-to-mid poly mountain range in Blender, bake PBR textures (albedo, normal, roughness, AO) from a sculpted high-poly pass, export as a single compressed glTF.
- **Path B (no 3D artist available):** Heightmap-driven terrain (displacement + normal map, real Western Ghats-style or Perlin/Simplex-generated), tiling PBR rock/moss/foliage materials, leaning on **fog + atmospheric perspective** to sell depth.

Either way: **layer 3–4 mountain "cards" or meshes at different depths.** With 4–5 stops now spread across a much longer journey, vary which peaks are prominent at each stop so the terrain doesn't feel like the same three mountains looping — foreground silhouettes should visibly change between Stop 1 and Stop 4.

### 1.3 The book & its path
- Modelled book: cover branded "Malnad Stories" (Cinzel wordmark, embossed on `#4A2C1D` espresso-brown leather), subtle page-edge detail, faint page-flutter shader.
- Attached to a single `THREE.CatmullRomCurve3` running through **six waypoints**, not a short A-to-B flight:

  ```
  W0 — Trailhead        book already resting in frame, opening beat
  W1 — Stop 1 ledge      "Why Choose Us"
  W2 — Stop 2 clearing   "How It Works"
  W3 — Stop 3 overlook   "Premium Features"
  W4 — Stop 4 grove      "Why You'll Love It"
  W5 — Cliff edge        "Our Promise" + finale CTA
  ```

- **Two motion states, alternating along the curve:**
  - **Transit** (between waypoints): book travels at normal pace, continuous slow spin + tangent-derived bank/tilt (like a paper plane leaning into turns) — this is where the "rotates while it travels" criterion lives.
  - **Dwell** (at each waypoint): forward travel eases to near-zero over a short scroll range, spin slows to a gentle idle turn (not a hard stop — a hard stop reads like the animation broke), camera reframes to a calmer, more static composition, and the content panel for that stop fades in.

### 1.4 Leaves
- Instanced leaf geometry (2–3 alpha-mapped variants), simplex-noise wind sway + gravity fall, continuous respawn loop, GPU-instanced.
- Thin the density slightly during **dwell** zones so falling leaves don't clutter text that's meant to be read; let it pick back up during **transit**.
- Denser swirl in the book's wake during transit for a reactive feel.

### 1.5 Scroll rig — the core change

One master pinned section, structured as alternating transit/dwell ranges rather than a single 0→1 flight. Rough vh budget (tune to taste, this is a starting allocation):

| Range | vh | Beat |
|---|---|---|
| 0–100vh | 100 | Opening reveal — book settles into view, no travel yet |
| 100–220vh | 120 | Transit to Stop 1 |
| 220–380vh | 160 | Dwell — Stop 1: Why Choose Us |
| 380–480vh | 100 | Transit to Stop 2 |
| 480–640vh | 160 | Dwell — Stop 2: How It Works |
| 640–740vh | 100 | Transit to Stop 3 |
| 740–920vh | 180 | Dwell — Stop 3: Premium Features (all 8 items, grid — a touch more time to scan) |
| 920–1020vh | 100 | Transit to Stop 4 |
| 1020–1180vh | 160 | Dwell — Stop 4: Why You'll Love It |
| 1180–1280vh | 100 | Transit to cliff |
| 1280–1460vh | 180 | Cliff arrival — Our Promise text, then CTA fades in |

**≈1460vh total pin.** Longer than the first pass now that all five stops carry the full, untrimmed content — the UX tradeoff from before applies even more here, worth confirming with the client before committing build time.

- `pin: true`, `scrub: true` (or `scrub: 1`) throughout — no scroll-jacking, no autoplay independent of scroll input.
- Implement as one progress value (0–1) mapped against the vh table above, rather than five separate ScrollTriggers — keeps camera, book, and content panels reading from one source of truth and avoids desync.
- Camera: **chase-cam** during transit (always looking at the book), settles to a more static framing during dwell so the content panel is legible and doesn't compete with a moving background.
- Add a **small progress trail** (5 markers, current one highlighted) fixed to a screen edge — orientation cue for a pin this long.

### 1.6 Performance & fallbacks
- Lazy-load the 3D bundle so hero text renders immediately.
- With five content panels now instead of one, lazy-load each panel's assets (images/icons) as its stop approaches rather than all upfront.
- `prefers-reduced-motion`: static graded stills or a looping WebM per stop, stacked as a simple scrolling sequence instead of the interactive scene.
- Mobile: cheaper terrain, capped leaf count, no Bloom/DepthOfField. Given the length of this journey, seriously consider a **shorter mobile-specific vh budget** (roughly half) rather than the same ~1460vh on a small screen — this was flagged as a later-pass decision, worth revisiting once the desktop version is approved.
- Target 60fps desktop, 30fps+ mobile.

### 1.7 Suggested file structure
```
src/
  components/hero/
    HeroCanvas.tsx        // <Canvas> wrapper, lazy-loaded
    Terrain.tsx            // mountain meshes + materials
    Book.tsx                // book model, path-follow + transit/dwell motion
    Leaves.tsx              // instanced leaf particle system
    CameraRig.tsx           // camera curve + lookAt logic, transit/dwell framing
    StopPanel.tsx           // content card shown during each dwell zone
    ProgressTrail.tsx       // 5-marker journey indicator
    HeroOverlay.tsx         // DOM headline/subhead/CTAs, opening + finale copy
    useScrollTimeline.ts    // ScrollTrigger setup, exposes progress 0–1
    HeroFallback.tsx        // reduced-motion / low-end static version
  assets/
    models/mountain-range.glb
    models/book.glb
    textures/...            // basecolor/normal/roughness/ao, ktx2
    leaf-atlas.png
  hero.constants.ts          // copy strings, waypoint + vh timing config
  stops.constants.ts         // per-stop content: title, body, icon
```

### 1.8 Content per beat (full text, from your scroll-page doc)

**Opening (W0):**
- Headline: "Documenting Memories. Preserving Forever."
- Subhead: "Turn your adventures into beautifully printed photo albums that last a lifetime."

**Stop 1 — Why Choose Us:**
- Memories That Last — Transform your favorite moments into timeless keepsakes you'll cherish forever.
- Crafted to Perfection — Every album is thoughtfully designed using premium materials and exceptional craftsmanship.
- Trusted by Thousands — Loved by travelers and families for creating beautiful stories that last a lifetime.

**Stop 2 — How It Works:**
1. Choose Your Album — Select your size, cover, pages, and finish.
2. Design Your Story — Upload photos, arrange them with AI or manually, then customize layouts, colors, stickers, and text.
3. Preview & Checkout — Review your album, place your order, and we'll print and deliver it to your doorstep.

**Stop 3 — Premium Features (all 8, compact grid — not trimmed):**
AI-Powered Album Design · Drag & Drop Photo Upload · Manual Page Editing · Personalized Text & Stickers · Multiple Album Sizes · High-Quality Printing · Secure Packaging · Fast Delivery Across India

**Stop 4 — Why You'll Love It:**
Premium Quality Materials · Vibrant HD Printing · Handmade Finishing · Secure Payment · Doorstep Delivery

**Finale (W5, cliff) — Our Promise + CTA:**
- "Every album is carefully designed, professionally printed, and handcrafted with attention to every detail — so your memories stay beautiful for generations."
- "Ready to Preserve Your Story?"
- Primary CTA: "Create Your Album" · Secondary: "Explore Collection"

After the pin releases: Customer Reviews section (plain DOM, not 3D — testimonials don't need WebGL treatment), then the page continues normally.

---

## Part 2 — The Build Prompt

Paste this directly into your AI coding tool. Written standalone so it doesn't depend on this doc's context.

```
Build a scroll-driven 3D hero section for "Malnad Stories," a premium travel
photo-album brand. Stack: React + Vite + TypeScript, React Three Fiber + drei,
GSAP + ScrollTrigger, @react-three/postprocessing.

CONCEPT
A single continuous journey: a book travels through a realistic mountain
range, pausing at five content stops along the way before arriving at a
cliff-edge finale. The book is already visible at rest in the very first
frame — no flying-in-from-a-distance opening. Three non-negotiable criteria
throughout every stop and transit segment:
1. Mountains read as realistic — layered depth, PBR-quality rock/moss
   texturing, atmospheric haze — never flat or low-poly/gamey.
2. Leaves fall continuously (thin slightly during dwell/reading beats, pick
   back up during transit) — never static or one-shot.
3. The book visibly rotates (spin + tangent-derived bank) WHILE traveling —
   during dwell beats this eases to a slow idle turn, never a hard stop.

ART DIRECTION
Palette locked to the client's approved six tones — do not introduce others:
#06281F midnight forest (deepest shadow) · #0B3D2E royal emerald ·
#145A41 imperial green (sunlit mid-tones) · #DCE8E2 sage silk (mist/haze) ·
#FFFFFF pure white · #4A2C1D espresso brown (book cover, warm accents).
Book cover: Cinzel wordmark embossed on espresso-brown leather. Foreground
terrain sharp and detailed; background peaks hazier, blending toward sage
silk fog. Reference real monsoon-forest hill photography, not stylized
game art.

JOURNEY STRUCTURE (single CatmullRomCurve3 through six waypoints)
W0 Trailhead (opening, no travel yet) → W1 Stop 1 ledge → W2 Stop 2 clearing
→ W3 Stop 3 overlook → W4 Stop 4 grove → W5 Cliff edge (Our Promise + finale
CTA). Two alternating motion states along the curve:
- TRANSIT (between waypoints): normal travel speed, continuous spin +
  tangent-derived bank into turns, chase-cam always looking at the book,
  denser leaf swirl in the book's wake.
- DWELL (at each waypoint): forward travel eases to near-zero (not a hard
  stop), spin slows to a gentle idle turn, camera reframes to a calmer,
  more static composition, leaf density thins slightly, and a content
  panel fades in for that stop.

SCROLL MECHANICS
One pinned section (~1460vh total, tune to taste), scrub: true, single
progress value (0-1) driving book position along the curve, camera state,
leaf density, and which content panel is visible — all reading from the
same source of truth, not independent triggers. Approximate vh allocation:
100vh opening reveal, then alternating ~100-120vh transit / ~160-180vh
dwell per stop across five stops (Premium Features gets slightly more,
180vh, since it carries all 8 items), ending in a ~180vh cliff arrival
where the Our Promise line fades in first, then the CTA.
Add a small 5-marker progress trail fixed to a screen edge so a pin this
long still feels oriented rather than endless.

CONTENT PER STOP (render as DOM panels over the canvas, not baked into
the 3D scene; fade in/out tied to scroll progress within that stop's range)
Opening: headline "Documenting Memories. Preserving Forever.", subhead
"Turn your adventures into beautifully printed photo albums that last a
lifetime."
Stop 1 (Why Choose Us): Memories That Last — Transform your favorite
moments into timeless keepsakes you'll cherish forever. Crafted to
Perfection — Every album is thoughtfully designed using premium
materials and exceptional craftsmanship. Trusted by Thousands — Loved by
travelers and families for creating beautiful stories that last a
lifetime.
Stop 2 (How It Works): 1. Choose Your Album — Select your size, cover,
pages, and finish. 2. Design Your Story — Upload photos, arrange them
with AI or manually, then customize layouts, colors, stickers, and text.
3. Preview & Checkout — Review your album, place your order, and we'll
print and deliver it to your doorstep.
Stop 3 (Premium Features, all 8 as a compact grid, not trimmed):
AI-Powered Album Design · Drag & Drop Photo Upload · Manual Page Editing
· Personalized Text & Stickers · Multiple Album Sizes · High-Quality
Printing · Secure Packaging · Fast Delivery Across India
Stop 4 (Why You'll Love It): Premium Quality Materials · Vibrant HD
Printing · Handmade Finishing · Secure Payment · Doorstep Delivery
Finale (cliff — Our Promise, then CTA): "Every album is carefully
designed, professionally printed, and handcrafted with attention to
every detail — so your memories stay beautiful for generations." Then
"Ready to Preserve Your Story?" — primary button "Create Your Album",
secondary "Explore Collection".

SCENE DETAIL
- Terrain: 3-4 depth-layered meshes, PBR-textured, fog blending distant
  layers to sky colour. Vary which peaks are prominent at each waypoint
  so the range doesn't feel like the same three mountains on a loop.
  Load /assets/models/mountain-range.glb if present; otherwise generate
  a placeholder heightmap terrain via simplex noise.
- Book: load /assets/models/book.glb (placeholder: bevelled box with a
  Cinzel "Malnad Stories" texture on espresso-brown if no glb yet).
- Leaves: GPU-instanced (2-3 shape variants, alpha-mapped), simplex wind
  sway + gravity, continuous respawn.
- Lighting: warm low-angle key light, cool ambient/fill, fog for depth.
- Post-processing: subtle Bloom, light DepthOfField on the book, Vignette.

PERFORMANCE & ACCESSIBILITY
- Lazy-load the 3D bundle; hero text renders immediately.
- Lazy-load each stop panel's assets as its waypoint approaches, not all
  upfront — five panels' worth of content shouldn't block first paint.
- prefers-reduced-motion: static graded stills or looping WebM per stop
  in a simple scrolling sequence instead of the interactive scene.
- Mobile: cheaper terrain, capped leaf count, no Bloom/DepthOfField, and
  flag a shorter mobile-specific vh budget as a follow-up decision rather
  than shipping the full ~1460vh journey unchanged on small screens.
- Target 60fps desktop, 30fps+ mobile.

DELIVERABLE
A self-contained <Hero3D /> React component (Terrain, Book, Leaves,
CameraRig, StopPanel, ProgressTrail, HeroOverlay, useScrollTimeline hook)
that drops into the Malnad Stories homepage, releasing into a normal
Customer Reviews section afterward. Include placeholder logic wherever a
real .glb/.png asset path is expected but not yet supplied, so the scene
degrades gracefully rather than breaking.
```

---

Flagging one thing I decided on your behalf: folding "Our Promise" into the cliff finale instead of giving it a separate stop, so it leads straight into the CTA rather than sitting mid-journey — say the word if you'd rather it stay as its own fifth mid-journey stop with the CTA as a bare sixth beat. And the pin budget is now ~1460vh with all content included untrimmed (see 1.5) — worth that same quick client check before committing build time, since it's grown since the last pass.
