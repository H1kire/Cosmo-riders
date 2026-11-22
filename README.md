# Cosmo-riders — Physics Engine

Browser-first JavaScript ES modules. The physics core has no runtime dependencies and uses SI units internally.

## Requirements and checks
- Node.js 20+ for the automated test suite.
- Modern browser with ES module support.
- Run `npm test`, `npm run audit`, or `npm run check`.

## Browser physics laboratory
Open `lab/index.html` through a local HTTP server (for example, `python -m http.server 8000` from the repository root, then visit `http://localhost:8000/lab/`). The lab visualizes the Sun–Earth and Earth–Moon systems, their Laplace SOI estimates, and a test vessel with selectable initial scenarios, time controls, single-step advance, and small prograde/retrograde impulses. The canvas views use separate local scales; they are schematic projections, not a common-scale map.

## Structure
- `src/physics/` — SI-only calculations, ephemerides and simulation state.
- `src/presentation/` — TeX formatting adapters, no physics.
- `tests/` — deterministic regression tests.
- `scripts/audit.js` — static audit.
- `docs/PHYSICS_AUDIT.md` — validation policy and known limits.
- `docs/SOLAR_SYSTEM_DATA.md` — data provenance and accuracy notes.

## Implemented
- 3D vector operations and physical constants.
- Universal-variable two-body propagation for elliptic, parabolic-limit and hyperbolic trajectories.
- Conversion between elliptic Kepler elements and inertial state vectors.
- Hierarchical Sun → Earth → Moon approximate J2000 ephemeris.
- Keplerian motion for orbiting bodies.
- Laplace sphere-of-influence estimates.
- Patched-conic active-primary switching with entry/exit hysteresis.
- Fixed-step clock, pause and time scale.
- TeX number formatting adapter for KaTeX rendering.

## Model limitations
This is a patched-conic approximation, not N-body gravity or a precision ephemeris. The built-in Moon orbit uses rounded educational elements; lunar perturbations are not integrated. See `docs/SOLAR_SYSTEM_DATA.md`. Automatic switching is currently between direct parent/child bodies; capture, escape and high-speed boundary-crossing cases require additional validation before mission-critical use.

All internal physical quantities use metres, kilograms, seconds, metres per second, metres per second squared, and cubic metres per second squared. Convert units only for display.