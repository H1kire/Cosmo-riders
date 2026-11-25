# Active foundation status

This file records current implementation facts on `test`. Older surface-pipeline and impulse-control descriptions were removed because they no longer matched the active scene and physics code.

## Rendering and camera

- `Solar3DView` is the active shared scene coordinator and uses WebGL2/GLSL. HDR, bloom, glare, lens flare, tone mapping, atmosphere, cloud layers, rings, lighting and analytic eclipse/occlusion calculations are connected to this scene.
- Global logarithmic and local linear display projections, focused-body camera origin, adaptive near clipping, camera controls and screen-space body picking are presentation behavior; they do not alter SI simulation state.
- Body rotation and orbit paths use state supplied by the Rust PhysicsWorld.
- The geodesic surface path is active only for Earth. It draws the twenty root faces while preparing its five channels; UV sphere rendering is used during preparation and on failure. The other bodies use the procedural sphere path.
- Quadtree selection, balancing, neighbor detection and stitch generation exist as CPU components, but the active geodesic draw list is not driven by adaptive leaves. The rendering path has not had browser/GPU visual verification.
- `HDRPipeline` is the connected post-processing path; `RingRenderer` is the connected annular-ring subsystem. The older parallel `RenderEngine`/`RenderPipeline` and standalone material/effect classes are not the active scene backend.
- Full shadow maps, volumetric ring shadows, logarithmic depth buffering and WebGPU are not implemented.

## Orbital mechanics and simulation

- Satellite relative two-body propagation uses combined parent/body GM. Modeled satellite elements declare their reference frame, and shared transforms are used for state and orbit presentation.
- The default ephemeris is approximate hierarchical J2000 Keplerian propagation. It is not DE440/Horizons precision data.
- Optional N-body propagation is implemented in the Rust PhysicsWorld using pairwise Newtonian gravity, catalogued J2 and adaptive step-doubling around kick-drift-kick velocity Verlet. It is not IAS15 and has no close-encounter regularization or impact response.
- Continuous engine thrust, changing mass, per-engine propellant depletion and gravity during powered motion are integrated through the Rust/WASM/Worker/client flight-control path. This is not a rigid-body attitude model: mounts create no torque and thrust vectors are inertial.
- The N-body option is available through the API but has no user-facing selector or switch-back operation. Its initial conditions and cached orbit paths remain based on the approximate catalogue.

## UI and verification boundary

- The flight deck exposes time controls, body selection, telemetry, continuous engine direction/throttle/duration controls, maneuver estimates and local-system navigation.
- Automated checks are described in `QUALITY_ASSURANCE.md`; they are not browser visual tests. GTX 1650 performance, GPU memory, seam quality and WebGL runtime behavior still require manual verification.
