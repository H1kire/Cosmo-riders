# Physics Engine Audit

## Scope 0.3.0
- SI units are mandatory in the physics layer.
- Universal-variable two-body propagation supports elliptic, near-parabolic and hyperbolic trajectories within floating-point stability limits.
- Orbital element conversion, orbital period and Laplace SOI calculations are available.
- Approximate J2000 Keplerian hierarchy contains the Sun, all eight planets and the Earth-Moon pair.
- Patched-conic primary switching uses direct parent/child SOI boundaries with hysteresis.
- Propulsion utilities calculate pressure-adjusted thrust, mass flow, TWR, idealized burn duration and rocket-equation propellant consumption.
- Maneuver utilities calculate coplanar Hohmann transfers and plane-change Δv.
- The flight deck exposes planetary mapping, vessel telemetry, continuous engine direction/throttle/duration controls and transfer estimates; the legacy impulse API remains separate.

## Browser map / rendering audit
- The WebGL 3D solar-system view uses a logarithmic spatial display projection so the planetary system fits on screen; this is presentation only and does not alter SI physics.
- On zooming into a selected/targeted body, the map transitions to a local linear projection. Parent and child bodies use their actual relative position vectors; satellite visibility is determined by real separation and camera scale, not a screen-space offset.
- Orbit paths are sampled from stored orbital elements, including inclination and orientation, then projected into the map view.
- Celestial bodies and the vessel are rendered from synchronized, non-mutating fractional-time snapshots between fixed physics steps. The renderer reuses the same body snapshot for vessel interpolation instead of propagating all bodies twice per frame.\n- The renderer maps the physics frame (XY reference orbital plane, Z normal) into a Y-up display frame (XZ orbital plane, Y normal). This aligns orbital planes with the planetary visual poles without modifying physical orbital elements or inclinations.
- The 3D camera starts above the reference orbital plane so the system is viewed face-on; orbital inclinations remain defined by the physical elements.
- A focused body remains the camera's local origin at every zoom distance. Zooming out no longer triggers a forced reset to the global view; rotating the camera can reveal the parent star and nearby system bodies.
- The renderer uses a separate `LightingEngine` module with registered point-light sources and reusable direction/intensity queries.\n- Sphere geometry uses three LOD tiers (10×14, 22×30 and 44×60 segments) selected from projected body size. Procedural shader patterns add broad surface variation and subtle vertex relief on rocky worlds; this is not a real heightmap or satellite texture dataset.\n- Orbital paths are drawn in 3D from the same stored orbital elements used by the physics model.
- The current catalogue contains the Earth-Moon pair only. The renderer discovers direct children generically, so further moons can be added with physical data without one-off drawing code.

## Automated checks
Run `npm run check` with Node.js 20+. Tests cover SI constants, vector arithmetic, inverse-square gravity, circular orbit closure, astronomical-scale propagation, energy and angular-momentum conservation, reversibility, hyperbolic escape, periapsis/apoapsis, orbital element conversion, J2000 Earth values, planetary hierarchy, SOI scale and switching, clock controls, Hohmann transfer, engine pressure response, TWR, rocket-equation burn and TeX formatting.

## Required review before every physics change
1. Validate dimensions and SI units for every equation.
2. Add nominal and boundary/error tests.
3. Check conservation laws where applicable.
4. Compare reference data with its stated epoch and frame.
5. Reject non-finite inputs and impossible states.
6. Never use rendered/rounded KaTeX text as numerical input.

## Known limitations
- Keplerian planetary ephemerides neglect mutual perturbations and are not precision navigation data.
- Moon elements are rounded and educational; use timestamped JPL Horizons/DE440 states for higher fidelity.
- SOI switching uses hysteresis and checks direct parent/child bodies after each fixed step; high-speed crossings may still be missed.
- The Rust PhysicsWorld now integrates continuous engine thrust, per-engine propellant depletion, changing vessel mass and gravity with RK4. Engine mount positions are metadata only because vessel attitude and torque are not modeled. Massive-body positions are sampled at the step boundary during vessel integration; the coupled planet/ship system is not yet a single high-order integrator.
- Hohmann transfers assume circular coplanar orbits; launch windows, phase targeting and capture are not solved.
- Planet rendering is procedural and currently has no high-resolution real surface textures, tiled/quadtree terrain, true heightmap displacement, atmospheric scattering, shadows, eclipses or body rotation. The current geometry LOD is a first visual tier, not the final terrain system.
- The planetary ephemeris remains a compact Keplerian approximation, not a precision JPL ephemeris.
- N-body gravity, attitude, staging, aerodynamics, heating, collisions and surface physics are not implemented.


## Development-branch correction (2026-11-23)

The older status statements above describe an earlier stage and are superseded for the current development branch: planetary spin, procedural cube-map surfaces, atmosphere/cloud passes and analytic eclipse visibility are now present. Satellite propagation uses combined parent/body GM and explicit ecliptic or approximate parent-equatorial reference frames. This remains a Keplerian mean-element model, not a precision ephemeris. See FOUNDATION_FIXES.md.


## Current implementation update

The earlier statements in this audit that rotation, atmosphere, cloud layers and analytic eclipse visibility are absent describe an earlier revision and are superseded on the current development branch. Planet rotation and procedural surfaces are active; atmosphere and clouds are separate shader passes; occultation is analytical. Satellite elements use combined two-body GM and a shared approximate parent-equatorial transform where configured. The model is still Keplerian and does not claim precision Horizons ephemerides, full shadow maps or N-body dynamics. See FOUNDATION_FIXES.md.


## Continuous propulsion update (2026-11-25)

- Each vessel can own multiple engines with independent thrust, ISP, throttle, enable state, inertial direction and propellant reserve.
- Resultant thrust vectors and mass flows are summed; each engine stops at its own fuel-depletion event.
- RK4 advances vessel position, velocity and mass under the combined point-mass gravity field and active thrust.
- WASM/Worker/Bridge/Client expose engine installation, enable, throttle, direction and telemetry commands.
- The active flight-control window now starts and stops a finite-duration prograde or retrograde burn and displays mass, thrust, mass flow, remaining propellant and acceleration.
- Fractional render snapshots include engine thrust while predicting the remaining part of a frame.
- The integration is not a full attitude/rigid-body propulsion model: engine mount offsets do not create torque, thrust direction is inertial and held fixed during a physics step, and body gravity is sampled at step-end positions.

## Adaptive N-body update (2026-11-25)

- The existing barycentric pairwise Newtonian system retains kick-drift-kick velocity Verlet as its base step.
- `advanced_adaptive` now estimates local error by comparing one full KDK step with two half steps, accepts the two-half-step state only when normalized position/velocity error meets tolerance, and reduces the step when the estimate or collision checks require it.
- PhysicsWorld uses this adaptive path for committed N-body advancement and arbitrary-time body snapshots.
- The variable-step wrapper is not exactly symplectic, is not IAS15 and does not provide close-encounter regularization. J2, post-Newtonian corrections and DE440/Horizons initial states remain absent.
