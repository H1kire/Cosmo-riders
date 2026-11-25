# Cosmo-riders architecture

## Responsibility boundaries

- TypeScript owns browser application state, DOM, camera input, scene coordination, diagnostics and GPU command submission.
- Rust owns the live simulation state, numerical physics, geodesic topology, mesh construction and deterministic surface-page generation.
- WebAssembly exposes Rust functionality to isolated Workers. Physics snapshots and generated channels cross the boundary as typed arrays.
- WebGL2/GLSL is the only active renderer. A complete WebGPU/WGSL backend and backend selector are not implemented.

## Simulation data flow

The flight deck creates one `PhysicsWorldClient`. Its `PhysicsBridge` owns one physics Worker, which initializes one Rust `PhysicsWorld` from the catalogue in `src/physics/solar-system.ts`. Rust is the sole live authority for body and vessel state; the client converts snapshots into presentation DTOs and caches Rust-generated orbit paths. The 2D map and `Solar3DView` consume those shared snapshots. Render-origin subtraction, scale changes and coordinate conversion are presentation transforms and do not modify SI state.

The default mode is hierarchical approximate J2000 Keplerian propagation. The same Rust world can opt into barycentric N-body mode through the Worker/client API. N-body initialization preserves vessel-relative position and velocity, but there is no disable/switch-back operation and no user-facing mode selector. N-body starts from the approximate catalogue states; it is not a scientific ephemeris. Its body integrator uses pairwise Newtonian gravity plus catalogued J2 and adaptive step-doubling around kick-drift-kick velocity Verlet. It is neither IAS15 nor a close-encounter regularized method. Dynamic orbit trails are not available.

Continuous engine thrust is integrated by Rust during committed vessel steps and fractional render snapshots. Multiple engines, per-engine propellant reserves, mass flow, depletion and commanded burn-end events are represented. Engine mount offsets do not produce torque because rigid-body attitude is not modeled; thrust direction remains inertial. Planet and powered-vessel integration are coupled using finite-step snapshots rather than one high-order coupled solve.

The TypeScript `PhysicsWorld` in `src/physics/` is retained as a comparison reference; the live flight deck does not instantiate it.

## Rendering and surfaces

`Solar3DView` owns one WebGL2 scene with shared body states, camera, render origin, selection, orbit paths, body rotation, lighting, atmosphere, clouds, rings, eclipses and HDR/post-processing. No WebGPU backend is active. WebGPU resource lifetime, device-loss recovery, WGSL render passes, backend selection and parity validation remain future work; WebGL2 must remain available through that migration.

The geodesic pipeline is connected only for Earth. It generates twenty root-face meshes and five surface channels through the bounded surface Worker pool and uploads them into bounded WebGL2 texture arrays. The UV sphere remains the active fallback while pages prepare or if generation fails. Quadtree selection, neighbor balancing and stitching exist as CPU components, but the active renderer still draws the twenty root faces. Other bodies use the procedural sphere path. Per-body geodesic integration and GPU-driven adaptive LOD are not complete.

Surface profiles are deterministic procedural visual models based on catalogue metadata. They are not measured global geology or a climate/geochemistry simulation. The four atmospheric giants use atmospheric procedural rendering rather than a solid terrain model.

## Worker boundaries

- `src/wasm/physics/physics-worker.ts`: owns one Rust PhysicsWorld and serializes simulation commands/snapshots.
- `src/rendering/geodesic/surface-tile-worker.ts`: generates Rust surface pages, geodesic meshes and stitch indices.
- Physics and surface work use separate Workers and do not require SharedArrayBuffer.

## Data conventions

- Physics uses SI units and f64 internally.
- Render positions are camera-relative before conversion to GPU f32.
- Surface height is in metres; channels are Albedo RGBA8, Normal RGB8, Height f32, Roughness R8 and Material ID R8.
- Worker-owned buffers are transferred rather than borrowed from WASM linear memory.

## Remaining implementation

- Scientific local ephemerides (DE440/DE441 or a validated equivalent), time/frame transformations and independent Horizons checks are absent.
- N-body close-encounter regularization, collision impact response, user-facing mode switching and dynamic orbit trails are absent.
- WebGPU is not implemented; all active render passes use WebGL2.
- The active geodesic renderer is Earth-only and does not yet use adaptive quadtree leaves.
- GTX 1650 browser performance, visual parity and rendered seam quality require manual GPU verification.
