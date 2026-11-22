# Physics Engine Audit

## Scope 0.3.0
- SI units are mandatory in the physics layer.
- Universal-variable two-body propagation supports elliptic, near-parabolic and hyperbolic trajectories within floating-point stability limits.
- Orbital element conversion, orbital period and Laplace SOI calculations are available.
- Approximate J2000 Keplerian hierarchy contains the Sun, all eight planets and the Earth-Moon pair.
- Patched-conic primary switching uses direct parent/child SOI boundaries with hysteresis.
- Propulsion utilities calculate pressure-adjusted thrust, mass flow, TWR, idealized burn duration and rocket-equation propellant consumption.
- Maneuver utilities calculate coplanar Hohmann transfers and plane-change Δv.
- The flight deck exposes planetary mapping, vessel telemetry, engine pulses and transfer estimates.

## Browser map / rendering audit
- The global solar-system view uses a logarithmic display projection so the planetary system fits on screen; this is presentation only and does not alter SI physics.
- On zooming into a selected/targeted body, the map transitions to a local linear projection. Parent and child bodies use their actual relative position vectors; satellite visibility is determined by real separation and camera scale, not a screen-space offset.
- Orbit paths are sampled from stored orbital elements, including inclination and orientation, then projected into the map view.
- Celestial bodies and the vessel are rendered from synchronized, non-mutating fractional-time snapshots between fixed physics steps.
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
- Engine burns are currently idealized impulses: the model computes mass loss and burn duration but does not integrate continuous thrust and gravity during the burn.
- Hohmann transfers assume circular coplanar orbits; launch windows, phase targeting and capture are not solved.
- The map is currently a 2D projection of 3D inertial coordinates; a full 3D free camera, terrain/surface LOD, textures, lighting/shadows and body rotation are future work.
- The planetary ephemeris remains a compact Keplerian approximation, not a precision JPL ephemeris.
- N-body gravity, attitude, staging, aerodynamics, heating, collisions and surface physics are not implemented.
