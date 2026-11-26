# Cosmo-riders

Browser-first spaceflight simulation foundation. The root page is the flight-operations interface; all physical calculations use SI units internally.

## Run locally
The game source is TypeScript (`src/`, `lab/`, `tests/`, and `scripts/`). Vite compiles the browser app to JavaScript in `dist/`; the browser never executes TypeScript directly. Use Node.js 20+ for the test suite. From the repository root:
- `npm test` — deterministic physics regression tests.
- `npm run audit` — syntax and static checks.
- `npm run check` — both test and audit.
- `python -m http.server 8000`, then open `http://localhost:8000/` — browser flight deck.

## Project structure
- `src/physics/` — SI-only vector, gravity, orbital, ephemeris, propulsion and maneuver calculations.
- `src/presentation/` — number/TeX formatting and the shared WebGL2/WebGPU 3D planetary scene.
- `lab/` — browser flight operations interface, 3D solar-system view and auxiliary telemetry canvases.
- `tests/` — deterministic regression tests.
- `docs/PHYSICS_AUDIT.md` — validation scope and known limitations.
- `docs/SOLAR_SYSTEM_DATA.md` — orbital data, sources and accuracy notes.

## Implemented foundation
- Universal-variable Kepler propagation for elliptic, near-parabolic and hyperbolic trajectories.
- Orbital elements ↔ inertial state conversion; orbital period and Laplace SOI estimates.
- Approximate J2000 hierarchy: Sun, Mercury, Venus, Earth, Moon, Mars, Jupiter, Saturn, Uranus and Neptune.
- Fixed-step simulation clock, pause, time scaling and patched-conic parent/child primary switching.
- Orbital validation for closure, reversibility, energy and angular momentum conservation, periapsis/apoapsis and hyperbolic escape.
- Chemical-engine performance model: pressure-adjusted thrust, specific impulse, mass flow, rocket equation, propellant use, burn duration and TWR.
- Idealized impulsive burn execution with vessel mass tracking.
- Coplanar Hohmann-transfer and plane-change Δv utilities.
- KSP-inspired interactive WebGL 3D overview with free-look orbit camera, zoom, pan, orbital paths, a spacecraft marker and hierarchical transition from logarithmic system scale to a local linear body scale.
- Planet surface rendering uses three geometry LOD tiers selected by projected size plus procedural shader detail; LOD is visual only and does not change physical radii or SI coordinates.
- Synchronized fractional-time rendering for celestial bodies and the vessel between fixed physics steps.
- Flight deck with planetary map, local Earth–Moon view, vessel telemetry, time controls, finite-duration continuous engine burns and an Earth-to-Mars Hohmann estimate.

## Model boundaries
The planetary ephemeris is a compact Keplerian J2000 approximation, not a DE440/Horizons precision ephemeris. The Moon uses rounded educational elements. Mutual planetary perturbations are not integrated in the default ephemeris mode. An opt-in Rust N-body mode is available through `PhysicsWorldClient.enableNBody()`; it uses the initialized approximate J2000 states as initial conditions and is not a DE440/Horizons precision simulation.

Continuous engine thrust is implemented in the Rust PhysicsWorld and exposed through the flight-control UI. Multiple engines can consume independent propellant reserves while vessel mass and gravity-driven motion are integrated during a finite burn. This is not a rigid-body propulsion model: engine mount offsets create no torque, thrust direction is inertial, and planet/vessel coupling uses finite-step snapshots. Attitude control, staging, aerodynamic drag, heating, collision response and surface operations remain future work.

The Hohmann planner assumes coplanar circular orbits and does not solve launch windows, phase matching, launch from a planetary surface or arrival capture. The 3D browser view uses a logarithmic global spatial projection and a local linear scale around the focused body; projection never changes the underlying SI physics. Planet appearance is procedural rather than sourced from high-resolution satellite texture maps. The geodesic surface pipeline is active for Earth only and currently draws its twenty root faces; its quadtree LOD components do not yet control the active draw list. Other bodies use the procedural sphere renderer.

All internal physical quantities use metres, kilograms, seconds, metres per second, metres per second squared, pascals, newtons and cubic metres per second squared. Convert units only for display.

## Foundation corrections

See [docs/FOUNDATION_FIXES.md](docs/FOUNDATION_FIXES.md) for the active rendering pipeline, per-body display adaptation, adaptive camera clipping, ring renderer, satellite orbital reference frames, combined two-body gravity, time controls and UI behavior.

## Foundation fixes

The development branch records the current implementation of adaptive camera clipping, screen-space body picking, distance-independent frame exposure, corrected atmosphere/cloud light normalization, satellite orbital reference frames, combined two-body gravity, 0×–100× time controls and restored utility-window navigation in [docs/FOUNDATION_FIXES.md](docs/FOUNDATION_FIXES.md). The satellite catalogue remains a modeled subset, not a complete list of natural satellites.

## Architecture migration: TypeScript + Rust + WebAssembly + WebGPU

The active flight-deck simulation now has one Rust-owned PhysicsWorld inside a dedicated WASM Worker. The TypeScript PhysicsWorldClient is a metadata/cache adapter: it sends commands and consumes packed snapshots, while Rust owns ephemerides, fixed-step time, vessel propagation, patched-conic SOI transitions, body spin phase, orbital paths, impulsive maneuvers and continuous engine burns.

The canonical J2000 solar-system catalogue remains declared once in src/physics/solar-system.ts and is passed to Rust at Worker initialization. Solar3DView renders Rust snapshots and uses orbit paths generated by Rust and cached by the client. The previous TypeScript PhysicsWorld is retained as a test reference, not as a second active simulation.

The geodesic Worker independently delegates mesh, stitching and five-channel surface-page generation to Rust. Surface height remains in metres. The physics and surface workloads use separate Workers; neither requires SharedArrayBuffer.

**WebGPU is now an active selectable renderer, but the migration is partial.** Auto (default) attempts a native WebGPU adapter/device and renders the existing Solar3DView body's live PhysicsWorld transforms as indexed, depth-tested spheres with four projected-size LODs, plus Rust-derived orbit paths and annular rings for Saturn, Jupiter, Uranus and Neptune. WGSL includes a compact sphere-space procedural material approximation for Earth, Mars, the Moon and giant-planet bands. The shared camera projection and render-origin-relative coordinates are used; WebGL2 remains an independent fallback surface. The full five-channel Rust geologic texture path, active adaptive geodesic quadtree LOD, atmosphere, clouds, eclipse/shadows and HDR/post-processing are not yet ported. CI validates code and deployment but does not execute a real WebGPU browser adapter or confirm GTX 1650 visual/performance parity.

See:
- [Architecture](docs/ARCHITECTURE.md)
- [Rust/WASM](docs/RUST_WASM.md)
- [Physics migration](docs/PHYSICS.md)
- [Procedural surface migration](docs/PROCEDURAL_SURFACE.md)
- [WebGPU migration status](docs/WEBGPU_RENDERING.md)
- [Migration checklist](docs/MIGRATION.md)

GitHub Actions builds the Rust/WASM package before running the TypeScript audit and Vite deployment. A successful CI build is not a substitute for visual/runtime testing on the target browser and GPU.

