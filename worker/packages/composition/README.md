# @workerv2/composition

The Worker V2 **Page Composition Engine** — the deterministic compositor that transforms a
**Blueprint surface** + **normalized image Artifacts** into a **rendered, content-addressed page
Artifact**.

> **Scope (task-phase 15 / frozen Render phase compositor half).** Layer stack + transform
> application + masks + clipping + frames + background fills + z-ordering + minimal blend modes +
> page rasterization + composition validation. **Not here:** PDF generation, album packaging,
> vendor/printing logic, or any storage of its own.

## Design

- **Consumes only Blueprint data + Artifacts.** The blueprint adapter is the single place blueprint
  data is read: each `placement` (an artifact identity at a normalized `frame`) becomes an image
  layer whose destination is that frame projected onto the pixel canvas and whose z-index is its
  (canonical, deterministic) order within the surface. Compositing attributes the blueprint does not
  carry (background, fit, frame border, opacity) come from deterministic `SurfaceCompositionOptions`.
  Text nodes are **not** rasterized (glyph rendering needs a font engine — a separate concern).
- **Deterministic.** Every pixel is a byte-exact function of the layer stack: integer sRGB blend
  math with `Math.round`, stable z-sort, orthogonal-only rotation. The same blueprint + artifacts
  (+ the deterministic render target) always render byte-identically and produce the same content
  address.
- **Pixel work runs through the replaceable `ImageBackend`.** Rotate / resize / crop / colour
  convert are delegated to `@workerv2/image-backend`, so **future GPU acceleration** plugs in behind
  the same backend contract with no change here. The per-pixel composite/blend loop is isolated in
  the `Canvas`.
- **Validate before producing.** A layer stack is validated before rasterizing, and the rendered
  page is validated (matches the target, is RGBA, consistent bytes) before it is ever produced as an
  Artifact — an invalid page cannot become an Artifact.
- **No storage / PDF / packaging / vendor logic.** Page rasters are produced through a host-wired
  `ArtifactBytesPort` (via the image-backend `PixelGateway`); the engine performs no storage itself,
  generates no PDF, and holds no album-packaging or vendor concepts.

## Features (the `LayerStack` compositor)

| Feature                      | Notes                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| **Background fill**          | Solid RGBA canvas fill.                                                                   |
| **Layer stack + z-ordering** | Stable sort by `z`; ties keep input order.                                                |
| **Transform application**    | Orthogonal rotate (90/180/270) + fit (`fill` / `cover` / `contain`) into the destination. |
| **Clipping**                 | Draw restricted to a clip rectangle.                                                      |
| **Masks**                    | Grayscale mask sampled as per-pixel alpha (resized to the fitted layer).                  |
| **Frames**                   | Border of a given thickness/colour drawn around the destination.                          |
| **Minimal blend modes**      | `normal`, `multiply`, `screen` (source-over, integer sRGB).                               |
| **Opacity**                  | Per-layer opacity folded into source alpha.                                               |
| **Page rasterization**       | Composite everything into one RGBA page raster.                                           |
| **Composition validation**   | `validateLayerStack` + `validateComposedPage`.                                            |

## Usage

```ts
const engine = new CompositionEngine(backend /* ImageBackend */, store /* ArtifactBytesPort */);
const rendered = await engine.composeSurface(blueprint, surfaceId, { width, height }, options);
// rendered.key = content-addressed page Artifact; rendered.page = the RGBA raster
```

`engine.rasterize(stack)` exposes the pure compositor path for callers that build a `LayerStack`
directly (no blueprint, no I/O).

## Boundaries

Depends on the foundation leaves + `infra-contracts` (`StorageKey`) + `blueprint` (the surface data
it composes) + `image-backend` (the `ImageBackend` it runs pixel work through + the Pixel Gateway /
byte port it produces page rasters with). It does **not** depend on the coordinator, manifest,
product, or any PDF/vendor package. Nothing depends on this package yet — a later render/assemble
stage will. Enforced by `scripts/check-boundaries.mjs`.
