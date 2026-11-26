# WebGPU rendering status

## Active first integration

Solar3DView owns the existing WebGL2 scene and an independent WebGPU canvas/backend. Auto is the default. It requests a real GPUAdapter and GPUDevice, configures a GPUCanvasContext, compiles WGSL and creates a depth-tested indexed sphere pipeline. Each frame, Solar3DView submits body transforms, camera view-projection, render-origin-relative positions, base colours and star/emissive flags derived from the same PhysicsWorldClient snapshot. Existing orbit paths, parent transforms, orbit fade and adaptive segment counts are also submitted to a WebGPU line-strip pass. No second physics world or camera is created.

The WebGPU canvas is a separate non-interactive overlay. The original WebGL2 canvas remains alive as fallback and retains pointer input and existing scene interaction. Backend preference is stored as cosmo-riders.graphics-backend.v1; cosmo-riders.graphics.v1 remains unchanged. Device loss triggers one recovery attempt, then reveals WebGL2 if recovery fails.

## Implemented WebGPU passes

- Four cached indexed sphere geometry LODs selected by the existing Solar3DView projected-size selector, with position and normal streams.
- WGSL vertex transforms using live body model matrices and the shared camera view-projection.
- Emissive star path, diffuse + ambient planet shading and sphere-space procedural Earth land/ocean/polar ice, Mars rust terrain, lunar relief variation and giant-planet banding.
- Depth24Plus attachment and depth testing.
- Per-body uniform buffers and bind groups cached by body ID.
- Cached orbit vertex buffers with alpha-blended line-strip rendering, existing parent transforms, opacity and segment LOD.
- Preferred canvas format, maximum 1920×1080 backing resolution, resize and resource disposal.
- Runtime backend diagnostics and Auto / WebGPU / WebGL2 selector.

## Not yet at WebGL2 parity

The WebGPU path currently does not render procedural surface maps, Rust geologic pages, adaptive geodesic quadtree tiles, rings, atmosphere, clouds, analytic eclipses/shadows, HDR, bloom, glare, lens flare or tone mapping. WebGPU uses a compact WGSL procedural material approximation driven by body seed and surface fractions; it is not yet the complete production GLSL material or the Rust five-channel geologic texture pipeline. The legacy WebGL2 scene still computes the complete old scene on its separate canvas, which is hidden while WebGPU is selected. These passes must be ported before claiming visual parity.

The active WebGL2 geodesic renderer remains Earth-only and currently draws its root-face set; adaptive quadtree selection/balancing is not integrated into its active render list.

## Verification

CPU sphere topology has unit tests. A static integration test checks that Solar3DView submits scene body transforms and orbit paths to the native backend. GitHub Actions validates TypeScript, tests and deployment after the branch push. These checks do not prove WebGPU runtime creation on a real browser/adapter or GTX 1650 performance. Manual Edge/Chromium verification remains required. No local browser, GPU, build or test was run for this change.
