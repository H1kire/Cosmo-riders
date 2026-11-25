# Loading System

## Current behavior

The loading overlay is present in both the root and `/lab/` entrypoints. `lab/main.ts` yields a frame before the dynamic import, and `lab/lab.ts` yields again before constructing the WebGL scene so the browser can paint the overlay first.

Solar3DView now exposes an initialization promise. Its base WebGL programs and UV sphere meshes are prepared in separate animation-frame slices, so the loading overlay can be painted and the browser event loop can run between expensive stages. The initial HDR target is 1×1 and the first resize is capped to 1920×1080 render pixels (before the selected render scale). Hardware MSAA is disabled because the HDR pipeline owns its own multisample target, and the pipeline is capped at 2× samples. The expensive geodesic work also remains outside the constructor and first scene frame:

- Geodesic renderer creation is deferred until after the first scene frame.
- GPU texture arrays are allocated one array per frame.
- Geodesic mesh and procedural surface-page generation are moved off the main thread into the single bounded module Worker pool.
- Worker results use Transferable Objects.
- GPU mesh-buffer creation and texture-page uploads share a bounded per-frame operation budget.
- The UV renderer remains visible while geodesic preparation runs and remains available after a failure.

The first Solar System frame is therefore independent of completion of all twenty geodesic root pages. The loading overlay can close when the scene is accessible; the geodesic surface continues preparing in the background.

## Reported stages

| Stage | Weight | Completion condition |
|---|---:|---|
| Bootstrap | 5% | Loading controller has reached its first frame |
| Application import | 5% | Dynamic import of `lab.ts` has completed |
| WebGL context | 15% | WebGL2 context and base renderer construction completed |
| Solar System | 20% | Physical world and initial scenario are prepared |
| Scene renderer | 15% | Base renderer and animation loop are registered |
| Geodesic surface | 20% | All twenty root pages and meshes are ready for drawing |
| GPU pages | 10% | All five texture arrays and twenty root page uploads are ready |
| First scene frame | 10% | A subsequent animation frame has rendered |

The progress percentage advances only when named stages actually complete. It is not a byte counter or a timer simulation. The loading overlay does not mark the background geodesic stages complete merely because the UV fallback scene is available. When the first frame is ready, the overlay may close while those stages remain pending.

## Failure behavior

Import and initialization failures are logged and shown in the overlay. Worker, mesh, texture allocation or upload failures are retained in graphics diagnostics and switch Earth back to the UV renderer. The Solar System scene remains available unless the base WebGL scene itself fails.

## Remaining limits

- WebGL context-loss recovery is not yet implemented.
- Shader compilation still uses the synchronous WebGL compile/link path; parallel shader compilation is not yet wired.
- Individual shader compilation/link calls and each individual sphere allocation remain synchronous within their own frame slice; WebGL does not provide a general non-blocking compile API here.
- The render target pixel ceiling limits framebuffer and post-processing cost, but it cannot prove that a particular Edge/GPU driver will not stall.
- The procedural surface worker pool is intentionally limited to one CPU worker and at most two pending tasks, leaving CPU capacity for Edge and the render loop.
- The optional Long Tasks observer reports the count and maximum duration of browser tasks; initialization diagnostics also report named stage timings and the longest synchronous slice.
- Actual first-frame and phase durations still need browser instrumentation and visual confirmation on the target GPU.
