# Architecture migration status

## Implemented in source

- Cargo workspace and pinned Rust toolchain.
- Rust f64 vector/orbital mathematics and wasm-bindgen exports.
- Rust icosahedron face/tile subdivision and triangular mesh generation.
- Rust deterministic geodesic surface-page generation with the five existing channels.
- Active geodesic worker initializes WASM and runs surface/mesh work off the main thread.
- GitHub Actions installs Rust/WASM tooling, runs Rust tests, generates wasm-bindgen output, then runs the existing TypeScript quality audit and Vite deployment.
- Static WASM package audit and bridge regression tests.

## Still on the legacy implementation

- Full PhysicsWorld/body catalog/vessel/patched-conic/propulsion execution remains TypeScript.
- Solar3DView and all active scene passes remain WebGL2/GLSL.
- HDR, bloom, atmosphere, clouds, rings, shadows and tone mapping have not yet been ported to WGSL/WebGPU.
- Runtime WebGPU device-loss/reinitialization and WebGL2 fallback orchestration are not implemented.
- A committed Cargo.lock still needs to be generated from the selected Rust toolchain/dependency graph.

## Verification boundary

The GitHub Actions workflow is the authority for Rust compilation/tests, wasm-pack output, TypeScript checks, Vite bundling and Pages deployment. A successful build does not prove visual parity, WebGPU runtime support, frame rate or browser stability on the user's GTX 1650.
