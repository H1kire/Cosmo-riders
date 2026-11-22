# Physics Engine Audit

## Scope 0.2.0
- SI units are mandatory in the physics layer.
- Universal-variable two-body propagation supports elliptic, near-parabolic and hyperbolic trajectories within floating-point stability limits.
- Hierarchical ephemerides propagate orbiting bodies from fixed J2000 initial states.
- The solar-system fixture contains Sun → Earth → Moon.
- Laplace SOI estimates and parent/child patched-conic primary switching are implemented.
- The engine remains patched-conic, not N-body.

## Automated checks
Run `npm run check` with Node.js 20+. Tests cover vector arithmetic, SI constants, inverse-square gravity, orbit closure at Earth and astronomical scales, energy conservation, reversibility, hyperbolic escape, element conversion, J2000 Earth reference elements, hierarchy movement, SOI scale, automatic Earth-to-Moon switching, pause/time scaling and TeX formatting.

## Required review before every physics change
1. Validate dimensions and SI units for every equation.
2. Add nominal and boundary/error tests.
3. Check conservation laws where applicable.
4. Compare reference data with its stated epoch and frame.
5. Reject non-finite inputs and impossible states.
6. Never use rendered/rounded KaTeX text as numerical input.

## Known limitations
- Two-body ephemerides neglect mutual perturbations and are not precision navigation data.
- Moon elements are rounded and educational; JPL Horizons/DE440 data should replace them for higher fidelity.
- SOI switching uses hysteresis and checks direct parent/child bodies after each fixed step; it does not yet detect all high-speed crossings within a step.
- N-body integration, engine thrust, mass flow, attitude, collisions and surface physics are not implemented.
- KaTeX is a presentation dependency; physics core remains independent.
