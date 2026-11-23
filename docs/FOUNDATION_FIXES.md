# Foundation fixes — Cosmo-riders

> **Surface rendering update:** the active renderer now uses direct GLSL terrain fields; the old CPU cubemap/Worker pipeline is disconnected. Orbit rendering has been returned to the continuous line-strip approach used by `main`, with the corrected satellite reference-frame transform retained. The spacecraft is intentionally absent from the active solar-system view.


## Rendering and camera
- Global frame exposure no longer changes with the focused body's distance from the Sun.
- A display-only per-planet gain is applied after physical surface lighting. The inverse-square light law, terminator and eclipse visibility remain in the lighting calculation; the display gain does not brighten the background or other bodies.
- Atmosphere and cloud shaders receive the 1-AU-normalized stellar irradiance exactly once.
- Camera zoom is clamped outside the focused body's mean radius. Screen-space body picking uses the projected body radius rather than a fixed 22-pixel centre target.
- The full 100 AU scene range is retained. The near plane adapts to camera distance and focused-body radius. This reduces the depth ratio near a planet, but is not a logarithmic depth buffer; extreme multi-scale Z precision still needs browser verification.
- Surface LOD activates earlier: 64 / 128 / 256 / 512 / 1024 / 2048 texels per cube-map face at increasing projected radii. Mesh LOD uses separate screen-space thresholds.
- Albedo sampling skips the unused height calculation; roughness uses a lower-cost class-aware procedural field. This removes redundant CPU work, but its visual appearance still needs checking.
- Cloud time is no longer wrapped every 100,000 simulation seconds.
- RingRenderer draws annular ring meshes for Jupiter, Saturn, Uranus and Neptune. The current rings are stylized procedural bands, not photometric/radiometric ring simulations.

## Orbital mechanics
- Relative two-body propagation uses mu = G * (M_parent + M_body).
- Satellite elements declare an explicit reference frame. The Moon retains ecliptic elements; other modeled satellites use an approximate parent-equatorial frame derived from the parent's pole.
- The same transform is shared by physics, 3D orbit lines and local orbit-path rendering.
- Synchronous satellite periods include both parent and satellite GM.
- These remain mean-element Kepler approximations, not precise JPL Horizons ephemerides or individual Laplace-plane solutions.

## Simulation controls and UI
- Time-scale choices: 0×, 1×, 2×, 5×, 10×, 50× and 100×.
- Manual engine impulses reset simulation speed to 1×.
- Selecting a body in the 3D renderer updates the selected object in the information panel.
- Telemetry, flight, maneuver-planner and local-system windows are available from the sidebar.
- Camera hints match the implemented controls: RMB orbit, MMB pan, LMB select.

## Rendering architecture
- Solar3DView is the active scene coordinator.
- HDRPipeline is the single active post-processing pipeline for HDR, Bloom, Glare and Lens Flare.
- RingRenderer is a connected dedicated visual subsystem.
- Atmosphere and clouds are separate rendering passes; eclipses/occlusion are analytical.
- The older parallel RenderEngine/RenderPipeline and standalone material/effect classes remain inactive scaffolding. Full shadow maps, volumetric ring shadows and logarithmic depth remain future work.
