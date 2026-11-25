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
- Default ephemeris mode uses hierarchical J2000.0 Keplerian elements and preserves ecliptic and parent-equator conventions. It is a compact approximate model, not DE440/Horizons output.
- Fixed-step accumulator, time scale, pause/resume, max-substep guard and non-mutating arbitrary-time snapshots.
- Optional dynamic mode is implemented inside the same PhysicsWorld and can be enabled with `PhysicsWorldClient.enableNBody()`. It converts the initialized hierarchy to barycentric coordinates, then integrates all catalogued massive bodies with pairwise Newtonian gravity and kick-drift-kick velocity Verlet. The Sun is dynamic rather than fixed at the origin.
- In dynamic mode, spacecraft are massless test particles integrated in the combined gravity field of all catalogued bodies. SOI selection is retained for primary-body display and local orbital metadata; it does not reset absolute position or velocity.
- Analytic sidereal spin angles are evaluated in Rust at the interpolated render time; tidal-locked orientation remains derived from the parent-relative orbital frame.
- Vessel position, velocity, mass, relative state, primary body and primary-switch history.
- SOI entry/exit hysteresis and patched-conic primary transitions.
- Legacy idealized impulsive maneuvers remain available as a separate planning tool.
- Continuous engines are owned by each Rust PhysicsWorld vessel. Every engine has an ID, name, maximum thrust, specific impulse, inertial thrust direction, mount-position metadata, throttle, enabled state and its own propellant reserve. Multiple engines can run simultaneously; their force vectors and mass flows are summed.
- Continuous burns are integrated in the same vessel state as gravity with RK4 over position, velocity and mass. The integrator splits a physics interval at the earliest commanded burn-end or engine propellant-depletion event, clamps fuel at zero and physically stops the relevant engine. Vessel mass includes installed engine propellant; fuel consumption reduces mass continuously.
- Engine control is exposed through WASM, the existing physics Worker protocol, PhysicsBridge and PhysicsWorldClient. The flight-control window configures prograde/retrograde direction, throttle and burn duration, and automatically shuts down the engine when the requested simulation-time interval ends.
- Propulsion telemetry reports current vessel mass, remaining propellant, thrust, mass flow and total instantaneous acceleration. Fractional-time vessel snapshots include currently active engines.
- Hohmann transfer, plane-change delta-v, circular-orbit speed, thrust-to-weight ratio and orbital-period calculations.
- Orbital paths are sampled in Rust and transferred to the renderer as Float64Array; Solar3DView no longer evaluates Kepler equations to construct orbit curves.

The old `apply_idealized_burn` API remains an instantaneous delta-v operation for explicit idealized planning; it is not used by the continuous engine controls. Continuous propulsion is now integrated during committed physics steps and fractional render snapshots. Engine mount positions are currently metadata only: the vessel has no attitude/angular-momentum state, so off-axis torque and engine gimbal dynamics are not modeled. Thrust directions are inertial vectors and are held constant over each physics step. Ephemeris-mode gravity is evaluated from the body's updated step-end positions; N-body vessel integration currently uses the massive-body step-end snapshot during the RK4 vessel step. These are finite-step coupling approximations, not a fully coupled high-order integration of planets and spacecraft.

The N-body integrator uses a fixed user-configured step and reports physical-radius collisions instead of softening singularities. It is a second-order symplectic method for smooth, well-separated motion; close encounters still require a smaller step. No adaptive close-encounter integrator, J2 model, relativistic correction or DE440 initial-state fit is implemented yet. Engine-driven spacecraft use RK4 against the current massive-body snapshot; planetary bodies themselves still use the existing fixed-step velocity-Verlet integration. No validated accuracy bound against JPL Horizons is claimed. N-body mode is opt-in through the Worker/client API and is not the default flight-deck mode; there is not yet a user-facing mode selector or a lossless switch back to ephemeris mode. The current orbit-path cache is still generated from the catalogue's initial Keplerian elements, so dynamic N-body trajectory trails are not yet represented.

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
