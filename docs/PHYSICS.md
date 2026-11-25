# Physics engine migration

## Active simulation authority

The browser flight deck now uses one Rust PhysicsWorld owned by src/wasm/physics/physics-worker.ts. The Worker is the sole owner of simulation state. PhysicsWorldClient and PhysicsBridge are command/snapshot adapters; they do not integrate celestial or vessel motion.

The declarative J2000 catalogue remains in src/physics/solar-system.ts. createSolarSystemBodyCatalog() maps that one catalogue to the WASM DTO contract. Rust builds the body hierarchy and calculates all committed and arbitrary-time ephemerides. The old TypeScript PhysicsWorld and createSolarSystemWorld() remain available only as a comparison reference for tests; the live flight deck does not instantiate them.

## Rust model

- f64 Vec3, Stumpff functions and universal-variable Kepler propagation.
- Elliptic, near-parabolic and hyperbolic state propagation, including negative time steps.
- State-vector to orbital-elements conversion.
- Elliptic elements to state conversion plus general conic conversion from semilatus rectum, eccentricity and true anomaly.
- Celestial-body definitions retain physical, rotation, pole, tidal-lock, surface, atmosphere and reference-frame metadata.
- J2000.0 hierarchical ephemerides preserve ecliptic and parent-equator conventions.
- Fixed-step accumulator, time scale, pause/resume, max-substep guard and non-mutating arbitrary-time snapshots.
- Analytic sidereal spin angles are evaluated in Rust at the interpolated render time; tidal-locked orientation remains derived from the parent-relative orbital frame.
- Vessel position, velocity, mass, relative state, primary body and primary-switch history.
- SOI entry/exit hysteresis and patched-conic primary transitions.
- Impulsive maneuvers, pressure-adjusted thrust, specific impulse, mass flow, rocket equation, propellant consumption and burn-duration estimates.
- Hohmann transfer, plane-change delta-v, circular-orbit speed, thrust-to-weight ratio and orbital-period calculations.
- Orbital paths are sampled in Rust and transferred to the renderer as Float64Array; Solar3DView no longer evaluates Kepler equations to construct orbit curves.

The burn model remains an idealized impulse: it calculates mass loss and burn duration from the rocket equation, then applies the requested delta-v instantaneously. It does not numerically integrate thrust, changing mass and gravity continuously during the burn.

## Application data flow

1. The flight deck creates one PhysicsWorldClient.
2. The client initializes one physics Worker with the canonical body catalogue.
3. Rust constructs one PhysicsWorld, initializes ephemerides and provides SOI values, rotation periods and orbit-path samples.
4. Frame-time commands are sent to the Worker. Rust advances fixed steps and computes a fractional-time render snapshot.
5. The client converts packed snapshots into lookup maps. Solar3DView consumes these maps, body metadata and Rust-generated orbit paths.
6. Render-origin subtraction and conversion to GPU-friendly local coordinates remain presentation operations; physical coordinates remain SI f64.

The geodesic surface Worker is separate and does not share the PhysicsWorld handle. Both the 3D renderer and the 2D flight-deck map consume precomputed Rust orbit-path samples; neither reconstructs the orbital curve in TypeScript.

## Automated reference validation

GitHub Actions currently verifies:

- all 50 catalogue bodies at J2000.0, one day, 30 days and one year against the retained TypeScript reference, using absolute and scale-relative position/velocity tolerances;
- arbitrary-time snapshots do not mutate committed simulation time;
- elliptic, near-parabolic and hyperbolic universal propagation and reversibility;
- elliptic, parabolic and hyperbolic conic-element conversion;
- vessel stepping and powered-burn mass/velocity parity against the TypeScript reference;
- SOI entry and preservation of absolute position/velocity across primary-body switching;
- time scale, fractional accumulator, pause/resume and oversized-backlog rejection;
- orbital path shape, finite values and closure;
- active application wiring from the physics Worker through PhysicsWorldClient into Solar3DView.

These are automated source/build tests. They do not prove browser runtime stability, visual orientation, orbit-line appearance, frame rate or GPU compatibility on the user's GTX 1650. Those still require an actual browser run.
