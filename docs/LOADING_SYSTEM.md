# Loading System

## Current behavior

The loading overlay is present in both the root and `/lab/` entrypoints. `lab/main.ts` yields a frame before the dynamic import, and `lab/lab.ts` yields again before constructing the WebGL scene so the browser can paint the overlay first.

The Solar3DView still creates its base WebGL programs, HDR pipeline and UV sphere meshes synchronously. The expensive geodesic work no longer runs in that constructor or in the first scene frame:

- Geodesic renderer creation is deferred until after the first scene frame.
- GPU texture arrays are allocated one array per frame.
- Root mesh construction and procedural surface-page generation use the shared bounded module Worker pool.
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
- Base WebGL program/HDR/sphere initialization is still synchronous, though geodesic mesh and page work has been moved off the main thread and GPU allocations are spread across frames.
- Actual first-frame and phase durations still need browser instrumentation and visual confirmation on the target GPU.
