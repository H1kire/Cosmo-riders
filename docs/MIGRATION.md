# Architecture migration status

## Implemented on test

- Cargo workspace and pinned Rust toolchain.
- Rust f64 vector/orbital mathematics, universal-variable Kepler propagation, state conversion and general conic conversion.
- Rust PhysicsWorld owns the live J2000 celestial hierarchy, fixed-step clock, ephemerides, vessel state, SOI hysteresis and patched-conic primary switching.
- Pressure-adjusted idealized propulsion, rocket-equation mass loss, impulsive maneuvers, Hohmann transfer, plane-change and orbital-period calculations are available through Rust/WASM.
- One dedicated physics Worker owns one WASM PhysicsWorld handle; TypeScript is a client/cache adapter.
- The live flight deck renders Rust body/vessel snapshots, interpolated Rust spin angles and Rust-generated orbit paths through the existing Solar3DView and 2D map.
- Initial circular-orbit velocities, gravitational parameters and thrust-to-weight calculations in the flight deck are queried from Rust/WASM.
- The legacy TypeScript PhysicsWorld remains only as a comparison reference for automated parity tests.
- A separate geodesic Worker delegates surface channels, meshes and stitch-index generation to Rust.
- GitHub Actions runs Rust tests, WASM build, generated-package verification, TypeScript tests/audits, Vite build, deployment audit and Pages deployment.

## Still on the legacy implementation

- Solar3DView and all active scene passes remain WebGL2/GLSL.
- HDR, bloom, atmosphere, clouds, rings, shadows and tone mapping have not yet been ported to WGSL/WebGPU.
- Runtime WebGPU device-loss/reinitialization and WebGL2 fallback orchestration are not implemented.
- The procedural surface renderer remains a hybrid: Rust creates surface data and geodesic meshes; WebGL2/GLSL performs rendering.

## Verification boundary

GitHub Actions is the authority for Rust compilation/tests, wasm-pack output, TypeScript checks, Vite bundling and Pages deployment. Automated parity tests cover the solar-system catalogue, spacecraft propagation/burns, SOI transitions, conic conversions, fixed-step clock and Rust-generated orbit paths. A successful build does not prove visual parity, frame rate or browser stability on the user's GTX 1650. No manual browser/game/WebGL test is performed by this workflow.
