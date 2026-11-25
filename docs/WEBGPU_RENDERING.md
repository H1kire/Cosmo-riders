# WebGPU rendering status

## Current implementation

WebGPU is not implemented as an application backend. `Solar3DView` obtains a WebGL2 context and renders the production scene with WebGL2/GLSL. There are no active WebGPU pipelines, WGSL scene passes, adapter/device lifecycle, device-loss recovery, or user-selectable Auto/WebGPU/WebGL2 backend. The graphics settings control quality and effects only. No WebGPU demonstration scene is present.

The active WebGL2 scene remains responsible for the shared camera and projections, render origin, body selection and rotation, orbit paths, labels, lighting and eclipses, atmosphere and clouds, rings, HDR, bloom, glare, lens flare and tone mapping. WebGL2 must remain the working fallback during a migration.

## Required migration boundary

WebGPU must consume the existing `Solar3DView` scene state and presentation data. It must not create a second body catalogue, camera, clock or physics state. Port the render passes in stages behind a common scene/backend contract, preserving global/local projection and camera-relative coordinates. Keep the current WebGL2 path active until the shared scene can switch backends without losing selection, focus, orbit, rotation, lighting or post-processing behavior.

Before making WebGPU selectable, implement and integrate:

- adapter/device/queue acquisition, capability and format checks, diagnostics, and a clear reason when initialization fails;
- owned buffers, textures, texture arrays, samplers, bind groups and pipeline lifetimes, with bounded resource budgets and disposal;
- resize handling, `device.lost` recovery, validation errors and a safe WebGL2 fallback path;
- WGSL equivalents for the production geometry, materials, lighting/eclipses, atmosphere/clouds, rings, stars/orbits and HDR/post-processing passes;
- a persisted Auto/WebGPU/WebGL2 preference that reports the active backend and any fallback reason;
- automated pipeline/device-loss/fallback checks and manual visual/performance review on representative GPUs.

## Verification status

No WebGPU pipeline or runtime check currently exists. GitHub Actions cannot establish visual parity on the target GTX 1650, and no local browser/GPU check is claimed for this branch. WebGPU must not be described as ready or production-active until the real Solar3DView uses it and the fallback/parity checks pass.
