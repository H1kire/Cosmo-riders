# Cosmo-riders

Browser-first spaceflight simulation foundation. The root page is the flight-operations interface; all physical calculations use SI units internally.

## Run locally
Use Node.js 20+ for the test suite. From the repository root:
- `npm test` — deterministic physics regression tests.
- `npm run audit` — syntax and static checks.
- `npm run check` — both test and audit.
- `python -m http.server 8000`, then open `http://localhost:8000/` — browser flight deck.

## Project structure
- `src/physics/` — SI-only vector, gravity, orbital, ephemeris, propulsion and maneuver calculations.
- `src/presentation/` — number/TeX formatting adapters.
- `lab/` — browser flight operations interface and canvas projections.
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
- KSP-inspired hierarchical map: logarithmic Solar System overview, then a local linear body-system view with physical parent-relative satellite positions and orbital-element-based orbit paths.
- Synchronized fractional-time rendering for celestial bodies and the vessel between fixed physics steps.
- Flight deck with planetary map, local Earth–Moon view, vessel telemetry, time controls, engine pulses and Earth-to-Mars Hohmann estimate.

## Model boundaries
The planetary ephemeris is a compact Keplerian J2000 approximation, not a DE440/Horizons precision ephemeris. The Moon uses rounded educational elements. Mutual planetary perturbations and N-body gravity are not integrated.

The propulsion layer currently calculates a burn's rocket-equation mass loss and duration, then applies its Δv as an idealized instantaneous impulse. It does not yet integrate thrust, changing mass and gravity continuously throughout the burn; attitude control, staging, aerodynamic drag, heating, collisions and surface operations remain future work.

The Hohmann planner assumes coplanar circular orbits and does not solve launch windows, phase matching, launch from a planetary surface or arrival capture. The browser map is a 2D XY projection with a logarithmic global overview and a local linear scale around the focused body; map projection never changes the underlying SI physics.

All internal physical quantities use metres, kilograms, seconds, metres per second, metres per second squared, pascals, newtons and cubic metres per second squared. Convert units only for display.
