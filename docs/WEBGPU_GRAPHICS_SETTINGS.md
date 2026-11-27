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

## GPU Page Cache diagnostics

The graphics diagnostics panel reads counters from the one shared WebGPU surface page cache, not per-planet estimates.

- allocatedBytes is the estimated allocation represented by created WebGPU texture-array descriptors. WebGPU does not expose a portable query for physical VRAM actually committed by the driver; the panel must not label this as measured device VRAM.
- residentBytes and resident/free/pinned/evictable page counts describe occupied cache layers. capacityBytes is the full page-layer capacity estimate and budgetBytes is the configured upper budget.
- Cache hit/miss, successful uploads, failed GPU uploads, LRU evictions and high-water resident count are cumulative for the lifetime of the active cache.
- CPU cache bytes/pages and worker state counts come from the shared VirtualSurfaceManager; GPU memory is not multiplied by the number of planets.
- The panel distinguishes an unallocated cache from an initialized but empty cache. Five texture arrays are allocated incrementally.


## Performance diagnostics (2026-11)

The graphics diagnostics panel includes a rolling 180-frame CPU timing window (FPS, average, median, p95 and peak), CPU command-encoding time, actual draw/pass counters, scene body/effect counts, geodesic tile draws, orbit/ring work and completed surface uploads per frame.

GPU frame timing is collected only when the adapter and device support the optional WebGPU `timestamp-query` feature. Render-pass timestamp results are copied to readback buffers and mapped asynchronously; the render loop never waits for readback. If the feature is unavailable, the UI reports that directly. WebGPU does not expose a portable GPU-utilization percentage, so no utilization estimate is fabricated.
