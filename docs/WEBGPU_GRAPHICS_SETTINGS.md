# WebGPU graphics settings

The graphics panel persists a complete preset and dispatches a live settings event to the active Solar3DView.

## Live runtime controls

- `renderScale` scales the HDR scene color target, depth target and post-processing source dimensions while the canvas presentation surface remains at its physical display size. Values are clamped to 0.50–1.25.
- `msaaSamples` selects 1x or 4x MSAA and is applied consistently to every scene pipeline and matching color/depth attachment; the scene resolves before HDR post-processing.
- `atmosphereSamples` is forwarded to the Rayleigh/Mie integration shader and clamped to its supported 2–16 range.
- `cloudDetail` is forwarded to cloud shell uniforms and bounded by each cloud layer's authored detail.
- `geodesic.uploadsPerFrame` is passed to each active planet runtime as its maximum number of newly started page requests in a frame. This is a per-planet runtime cap, not a global cap across all visible planets.
- Changing the geodesic profile recreates the page/mesh subsystem so page resolution, mesh resolution, worker count and cache budgets take effect immediately; the previous subsystem is disposed first.
- Saved nested geodesic settings are restored instead of silently replaced by preset defaults.
- `geodesic.pageResolution`, `meshResolution`, CPU/GPU cache budgets and worker count configure the geodesic page/mesh pipeline when it is created.
- Bloom, HDR, exposure, tone mapping, glare and lens flare are consumed by the existing post-processing pass.

## MSAA

The renderer supports single-sample and 4x MSAA. The scene color target is rendered into a multisampled `rgba16float` attachment and resolved into the single-sample HDR scene texture before post-processing; depth uses the same sample count. Sphere, atmosphere/cloud effects, orbit, ring and all four geodesic transition pipelines share the selected sample count. A runtime change rebuilds the complete pipeline/resource family; if 4x is rejected by the adapter, the renderer retries at 1x and exposes the fallback in diagnostics.

## Verification boundary

Static tests assert profile propagation, bounded controls and render-target sizing. Browser/GPU visual verification remains reserved for the final visual-quality stage.
