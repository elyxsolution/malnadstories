# ADR-0016 — Page Composition Engine: a deterministic Blueprint → page-Artifact compositor

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 8 (Render Engine — the page compositor half; task-phase 15)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The Blueprint Platform (ADR-0008) describes an album as a tree of surfaces (cover/spreads) whose
placements bind a content-addressed image artifact to a normalized frame; the Native Image Backend
(ADR-0015) provides deterministic pixel transforms + a Pixel Gateway that produces content-addressed
raster Artifacts. This task-phase builds the layer between them: the **Page Composition Engine** —
the deterministic compositor that turns a Blueprint surface + normalized image Artifacts into a
rendered page Artifact.

Constraints from the objective: consume only Blueprint data + Artifacts; produce immutable rendered
page Artifacts; deterministic output; framework-independent; no PDF generation, no album packaging,
no vendor/printing logic, no storage of its own, no business logic; implement layer stack, transform
application, masks, clipping, frames, background fills, z-ordering, minimal blend modes, page
rasterization, and composition validation; design for future GPU acceleration behind the
`ImageBackend`; validate rendered pages before producing Artifacts.

Decisions needed: (1) what the compositor operates on; (2) how blueprint data maps to layers when
the blueprint carries only placement geometry (no opacity/blend/mask/frame/background); (3) where the
pixel work lives so a GPU backend can accelerate it; (4) how determinism + content-addressing hold;
(5) how text is handled; (6) where produced-page validation sits.

## Decision

**1. Composite over a generic, framework-independent `LayerStack`.** The core compositor rasterizes
a `LayerStack` — a canvas size, a background fill, and an ordered set of `Layer`s (each: source
raster, destination rect, z, opacity, blend, fit, optional rotate/mask/clip/frame). This is pure
data + geometry over the image-backend's `RasterImage`; it is the full feature surface (transform,
masks, clipping, frames, background, z-order, blend) and is unit-tested directly, independent of any
blueprint.

**2. A thin blueprint adapter is the ONLY reader of blueprint data.** `surfaceToLayerStack` maps a
surface's placements to image layers: destination = the placement's normalized `frame` projected onto
the pixel canvas (deterministic rounding), z = the placement's canonical order within the surface,
clip = the destination. Compositing attributes the blueprint does not carry (background, fit, frame
border, opacity) come from deterministic `SurfaceCompositionOptions` — engine configuration, not
domain data, exactly like the render target. This keeps "consume only Blueprint data + Artifacts"
true at the entry point while still delivering the full compositor feature set.

**3. Pixel work is delegated to the replaceable `ImageBackend`; only the composite/blend loop is
local.** Rotate/resize/crop/colour-convert run through `ImageBackend`, so a future GPU backend
accelerates composition with no change here. The per-pixel source-over blend loop (with the minimal
blend modes) is isolated in a backend-free `Canvas`, keeping the deterministic pixel math in one
reviewable place.

**4. Deterministic + content-addressable by construction.** Integer sRGB blend math with
`Math.round`, a stable z-sort (ties keep input order), and orthogonal-only rotation make every page
byte-exact for a given stack. The page raster is encoded through the image-backend's deterministic
WV2R container and produced via the Pixel Gateway, so the same blueprint + artifacts (+ target)
yield the same content address (idempotent).

**5. Text is out of scope for the compositor.** Blueprint `text` nodes are acknowledged but NOT
rasterized — glyph rendering needs a font engine, a separate concern. The compositor composites image
layers; a later text/render stage can add a text layer type behind the same `LayerStack`.

**6. Validation gates production, twice.** `validateLayerStack` runs before rasterizing (positive
canvas, legal fit/blend/opacity, sane geometry); `validateComposedPage` runs before producing
(matches the target, is RGBA, passes the backend's raster gate). An invalid page is never produced as
an Artifact.

## Options Considered

1. **Generic `LayerStack` compositor + thin blueprint adapter, pixel work behind `ImageBackend`
   (chosen).**
2. **Composite directly from blueprint nodes (no intermediate layer model).** Rejected: it would
   entangle blueprint traversal with pixel compositing, make the feature set (masks/clip/frame/blend)
   awkward to express and test, and couple the compositor to the blueprint schema. The layer model is
   the reusable, testable seam.
3. **Implement the blend/resize loop inside the compositor (bypassing `ImageBackend`).** Rejected:
   duplicates transform code and forecloses GPU acceleration. Delegating transforms to the backend is
   the "design for future GPU" requirement.
4. **Rasterize text now (bundle a font engine).** Rejected: fonts + glyph shaping are a large,
   separate concern with their own determinism story; the blueprint explicitly does not resolve text
   styling. Reserved as a future layer type.
5. **Derive opacity/blend/frame/background from the blueprint.** Rejected: the blueprint model does
   not carry them; inventing schema here would exceed scope. They are deterministic engine options,
   with a clean seam for a future theme resolver to supply them.

## Consequences

- **Positive:** a deterministic, framework-independent page compositor with the full feature set
  (transform/mask/clip/frame/background/z/blend), byte-reproducible and content-addressable; pixel
  work is GPU-ready behind `ImageBackend`; validation makes an invalid page Artifact impossible; the
  engine is provably free of PDF/packaging/vendor/storage logic (grep + boundary verified).
- **Negative / trade-offs:** text is not rendered yet (image layers only); blend modes are the
  minimal three (`normal`/`multiply`/`screen`); rotation is orthogonal only; per-placement
  opacity/blend/frame come from options rather than per-node blueprint data (a future theme resolver
  can enrich this). All reserved behind the existing `LayerStack`/options seams, none blocking.
- **Follow-ups / remaining risks:** wire a text layer type + font engine when text rendering is
  scoped; let a theme/layout resolver populate per-layer compositing attributes; feed real
  normalized image Artifacts (from the image pipeline via the Pixel Gateway) as placement sources;
  the produced page raster is a compositor output — turning pages into a print-ready PDF is a later,
  separate phase (this engine deliberately generates no PDF).

## Compliance

Framework-independent; strict TypeScript; full unit tests (43 new; `pnpm verify` green — 611 total,
25 packages). Consumes only Blueprint data + Artifacts (+ a deterministic render target/options);
produces immutable, content-addressed page Artifacts; validates the stack and the rendered page
before producing. Deterministic: integer sRGB blend math, stable z-sort, orthogonal rotation, pixel
work through the deterministic `ImageBackend` (byte-identical, test-proven). Pixel transforms run
behind `ImageBackend` (future GPU acceleration). No PDF generation, no album packaging, no
vendor/printing logic, no storage of its own, no business logic (grep + boundary verified).
Boundaries: depends only on foundation leaves + infra-contracts + blueprint + image-backend; nothing
depends on this package yet.
