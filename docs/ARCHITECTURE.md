# Cosmo-riders architecture

## Responsibility boundaries

- TypeScript owns browser application state, DOM, menus, camera input, scene coordination, diagnostics and GPU command submission. It also holds declarative solar-system and presentation metadata.
- Rust owns simulation state and numerical physics, as well as geodesic topology, mesh construction and deterministic surface-page generation.
- WebAssembly exposes Rust functionality to isolated browser Workers. Numeric snapshots and generated channels cross the boundary as typed arrays where practical.
- WebGL2/GLSL remains the active renderer. WebGPU/WGSL is the target backend; it is not yet implemented as a complete replacement.

## Current application data flow

The root flight-deck page loads lab/main.ts, which starts the browser application. lab/lab.ts creates a single PhysicsWorldClient; its PhysicsBridge owns one dedicated physics-worker.ts. The Worker initializes wasm-bindgen and creates exactly one Rust PhysicsWorld from the declarative catalogue.

Rust owns celestial ephemerides, the fixed-step accumulator, vessel state, patched-conic primary transitions, SOI hysteresis and idealized propulsion/maneuver calculations. It also precomputes orbital paths. The Worker returns packed Float64Array snapshots and orbit-path buffers.

PhysicsWorldClient is a DTO/cache adapter. It creates CelestialBody presentation metadata, stores the Rust snapshots and makes body/orbit data available to the view. It does not independently propagate bodies or vessels. Solar3DView consumes those states, Rust-computed spin angles and Rust-generated orbit paths; the 2D map uses the same orbit-path cache. Render-origin subtraction and coordinate conversion are visual transforms only.

The old TypeScript PhysicsWorld remains in src/physics/ as a comparison reference for automated parity tests. It is not instantiated by the active flight deck. Do not reintroduce a second live simulation authority.

## Worker boundaries

- src/wasm/physics/physics-worker.ts: one PhysicsWorld handle; serialized commands, snapshots, orbital computations and vessel operations.
- src/rendering/geodesic/surface-tile-worker.ts: WASM surface channels, geodesic meshes and stitch indices.
- The existing surface worker pool retains its bounded scheduling, priorities, deduplication, cancellation and transferable-buffer behavior.

The physics Worker uses one worker thread and does not require SharedArrayBuffer, atomics or WASM threads.

## Data conventions

- Physics uses SI units and f64 internally.
- Physical coordinates are never scaled to fit the camera.
- Render positions are made camera-relative before conversion to GPU f32.
- Surface tile height is f32 in metres.
- Surface pages preserve Albedo RGBA8, Normal RGB8, Height f32, Roughness R8 and Material ID R8 channels.
- Worker-owned buffers are transferred rather than retaining borrowed views into WASM linear memory.

## Remaining migration

The complete 3D renderer still uses WebGL2: planet materials, atmosphere, clouds, rings, lighting/shadows, HDR, bloom and tone mapping. A future WebGPU backend must preserve the one-scene camera, global/local projection, tracking, render origin and all existing visual passes, with WebGL2 retained as fallback until parity is demonstrated.
