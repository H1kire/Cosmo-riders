# Physics Engine Audit

## Scope 0.1.0
- SI units are mandatory in the physics layer.
- Point-mass gravity and universal-variable two-body propagation are implemented.
- Universal variables cover elliptic, near-parabolic and hyperbolic conics within floating-point stability limits.
- Classical orbital elements are derived from state vectors; circular/equatorial singularities are flagged.
- PhysicsWorld uses a fixed step and one active primary per vessel (one patched-conic segment).
- Automatic SOI transitions, moving-body ephemerides, N-body integration, collisions, thrust and attitude dynamics are not implemented.

## Automated checks
Run `npm run check` with Node.js 20+. Tests cover vector arithmetic, SI constants, inverse-square gravity, circular-orbit closure at Earth and astronomical scales, specific-energy conservation, forward/backward reversibility, hyperbolic escape, orbital-element classification, SOI scale, pause/time-scale behavior and TeX formatting.

## Required review before every physics change
1. Validate dimensions and SI units for each equation.
2. Add nominal and boundary/error tests.
3. Check conservation laws where applicable (energy and angular momentum for isolated two-body motion).
4. Test forward and backward propagation where supported.
5. Reject non-finite inputs and impossible states.
6. Never use rendered/rounded KaTeX text as numerical input.

## Known limitations
- Automatic switching between primaries at SOI boundaries is not implemented.
- Celestial-body positions are fixed during a world step; ephemerides are a later module.
- Extreme hyperbolic cases may be rejected when hyperbolic functions exceed stable floating-point range.
- KaTeX is not a physics dependency. The adapter returns TeX; the local KaTeX browser bundle will be vendored with the math UI, so the core stays independent of third-party libraries.