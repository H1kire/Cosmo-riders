# Cosmo-riders — Physics Engine

Initial physical simulation core. Browser-first JavaScript ES modules; no runtime dependencies in the physics layer.

## Requirements
- Node.js 20+ for tests.
- Modern browser with ES module support.

## Commands
```sh
npm test
npm run audit
npm run check
```

## Structure
- `src/physics/` — SI-only calculations and simulation state.
- `src/presentation/` — TeX formatting adapters, no physics.
- `tests/` — deterministic regression tests.
- `scripts/audit.js` — static audit.
- `docs/PHYSICS_AUDIT.md` — validation policy and limitations.

## Implemented 0.1.0
3D vector operations, physical constants, gravitational parameter, point-mass acceleration, universal-variable Kepler propagation, orbital elements, Keplerian period, sphere of influence, fixed-step clock, pause/time scale, and vessel propagation around one active primary.

## Not implemented
Automatic patched-conic primary transitions, ephemerides, N-body integration, thrust/mass flow, attitude, collisions, and all game/UI systems.

Engine units: metres, kilograms, seconds, metres per second, metres per second squared, and cubic metres per second squared. Convert units only for display.