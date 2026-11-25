# Physics implementation audit

## Active authority and units

The flight deck creates one Rust `PhysicsWorld` in the physics Worker. `PhysicsWorldClient` and `PhysicsBridge` send commands and adapt returned snapshots; they do not integrate a parallel live simulation. The retained TypeScript physics implementation is a test/reference path. Physics state uses SI units and f64. Display projection and conversion to GPU-friendly coordinates occur in the presentation layer.

## Implemented models

- Universal-variable two-body propagation supports elliptic, near-parabolic and hyperbolic states. The live default is a hierarchical approximate J2000 Kepler model from the catalogue, not a precision ephemeris.
- Patched-conic primary selection uses SOI hysteresis. Changing the displayed primary preserves the vessel's absolute state.
- Optional barycentric N-body mode integrates massive-body pairs with Newtonian gravity, catalogued J2 and kick-drift-kick velocity Verlet wrapped in adaptive step-doubling error control. Spacecraft are massless test particles in this field; powered spacecraft use RK4 against finite-step body snapshots.
- N-body mode starts from the catalogue's approximate states. It is opt-in through the Worker/client API; there is no user-facing mode selector, switch-back operation, or dynamic N-body orbit trail.
- The adaptive N-body scheme is not IAS15 and does not regularize close encounters. Collision-radius detection rejects/rolls back invalid steps; it does not resolve impacts. No validated error bound against Horizons is claimed.
- Continuous engine burns are integrated with gravity and changing mass. Multiple engines have independent throttle, ISP, enabled state and propellant. Burn end and per-engine depletion stop thrust at the event. Telemetry and fractional-time snapshots are wired through WASM, Worker, client and flight controls.
- Engine mount offsets are metadata only: attitude, angular momentum, torque and gimbal dynamics are absent. Direction is inertial and held across each physics step.
- The flight deck also exposes legacy idealized delta-v maneuvers as a separate API and Hohmann/plane-change estimates; the Hohmann estimate assumes circular coplanar orbits.

## Data and coverage limits

- DE440/DE441 local ephemeris data, Horizons control states, explicit high-precision time-scale conversion and independent frame-transform validation are not implemented.
- The default Kepler mode does not include mutual planetary perturbations. The N-body mode's starting state is still approximate.
- Higher gravity harmonics, pole precession/libration, post-Newtonian corrections, impact physics, rigid-body attitude, staging, aerodynamics, heating and surface operations are absent.
- SOI checks run at simulation-step boundaries; sufficiently fast crossings can be missed. Dynamic N-body orbit paths are not cached.

## Automated checks present in the repository

The repository contains Rust and TypeScript tests for orbital propagation, the catalogue, SOI changes, time control, maneuvers, continuous propulsion, N-body conservation/error behavior, J2, Worker/WASM integration and active rendering contracts. The exact CI result must be read from GitHub Actions for the commit being reported. These automated checks do not demonstrate browser behavior, visual correctness, performance or GTX 1650 GPU compatibility.

For current commands and workflow boundaries, see `QUALITY_ASSURANCE.md`. For parameter provenance and model epochs, see `SOLAR_SYSTEM_DATA.md` and `RUST_WASM.md`.
