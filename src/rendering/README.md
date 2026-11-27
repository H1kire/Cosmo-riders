# Cosmo-riders WebGPU rendering architecture

## Source of truth

The active renderer is **WebGPU-only**. The live scene is assembled by `src/presentation/solar-3d.ts`; physics remains authoritative for body state, orbital state, simulation time and rotation phase.

The following older modules are not part of the active frame path and must not be treated as runtime fixes for the current renderer:

- `core/render-engine.ts`, `core/render-pipeline.ts`, `core/hdr-pipeline.ts`: standalone/legacy orchestration.
- `geodesic/geodesic-planet-renderer.ts`: WebGL2 geodesic implementation.
- `rings/ring-renderer.ts`: WebGL2 ring implementation.
- `procedural-surface/surface-generator.ts`, `surface-map-cache.ts`, `surface-worker.ts`: legacy cube-map generator and cache.
- `shaders/planet-surface.ts`, `shaders/planet-effects.ts`, GLSL chunks: legacy GLSL material path.

Do not add new features to these legacy modules unless a future migration explicitly makes them active. The current active surface generator is `geodesic/surface-tile.ts`.

## Active frame path

```text
Solar3DView.render(world, states, simulationTime)
  ├─ reads current physics states and renderRotationAngles
  ├─ builds camera-relative body/model matrices in AU render coordinates
  ├─ builds orbit line data from world.orbitPaths / world.ensureOrbitPath
  ├─ builds per-body surface, atmosphere, cloud, ring-shadow and occluder data
  └─ WebGPUBackend.render(WebGPUFrame)
       ├─ WebGPUGeodesicSurfaceSystem.initializeStep / beginFrame
       ├─ one main scene render pass
       │    ├─ solid bodies: geodesic tiles from WebGPUGeodesicSurfaceSystem
       │    ├─ stars and gas/ice giants: WebGPU sphere pipeline
       │    ├─ atmosphere and cloud shells: WebGPU effect pipeline
       │    ├─ rings: WebGPU ring pipeline
       │    └─ orbital paths: WebGPU line pipeline
       ├─ WebGPUGeodesicSurfaceSystem.endFrame / afterSubmit
       └─ post-processing command passes
            ├─ bright extraction (when bloom is enabled)
            ├─ separable blur iterations (when bloom is enabled)
            └─ final composite to the canvas (exposure, tone mapping,
               glare and lens-flare contribution)
```

The main scene components currently share one render pass with a depth attachment. Atmosphere/cloud shells, rings and orbits are ordered after body surfaces in that pass. There is no separate full-scene shadow-map pass: surface, atmosphere and ring shadows use analytical ray/sphere or apparent-disc calculations.

## Geodesic solid-body surface path

```text
WebGPUBackend
  → WebGPUGeodesicSurfaceSystem
      → per-body GeodesicSurfaceRuntime (20 icosahedron root faces,
        Quadtree selection, 2:1 balancing and stitch masks)
      → shared VirtualSurfaceManager / SurfaceWorkerPool
          → surface-tile-worker.ts → WASM generate_surface_tile()
              → crates/cosmo-core/src/surface.rs::generate_tile()
      → shared WebGPUSurfacePageCache (five texture-array channels)
      → WebGPUGeodesicSurfaceRenderer (WGSL, indexed patch meshes,
        physical Height displacement, PBR material and analytical shadows)
```

The five channels are albedo (RGBA8), normal (RGBA8 in GPU storage; RGB in worker data), height (R32F, metres), roughness (R8) and material ID (R8). Tile identity includes the body/profile, seed, tile address, resolution and gutter. The renderer uses the same simulation-supplied body transform and camera-relative frame as the rest of the scene.

The page cache is shared between all solid bodies. Its capacity is constrained by the configured byte budget, texture-array layer limit and configured maximum page count. Pins protect pages required by the current visible set and LOD transition; a full pinned cache is a budget-pressure condition, not evidence that the physical GPU has allocated exactly that amount of VRAM.

## Actual quality and rendering controls

- Geodesic page resolution, mesh resolution, CPU/GPU budgets, worker count and upload budget come from `GraphicsSettings.geodesic`.
- Atmosphere and cloud parameters are sent from `Solar3DView` to the active WebGPU frame.
- Bloom, exposure, HDR tone-mapping selection, glare, lens flare and render scale are consumed by `WebGPUBackend`.
- MSAA is configured as 1× or 4×; unsupported 4× configuration is retried at 1×.
- WebGPU timestamp queries are optional. CPU/backend encode time and GPU timestamp time are separate measurements.

## Known limits (not claims of completed physical simulation)

- The surface field is deterministic procedural geology, not a geochemical or tectonic evolution simulation.
- Atmospheric scattering and cloud rendering are bounded approximations; they are not full multiple-scattering or weather models.
- Planetary shadows, eclipses and ring shadows are analytical approximations, not cascaded shadow maps.
- The planetary catalogue uses J2000 mean elements and a hierarchical two-body approximation. It is not a DE440/Horizons ephemeris integration.
- Visual correctness, seams, temporal stability and target-device performance still require browser/WebGPU runtime verification. CI and static inspection do not establish visual correctness.

## Coordinate contract

Physics stores SI positions and velocities. `Solar3DView` converts the render snapshot into camera-relative AU coordinates at the presentation boundary. Geodesic surface selection converts the camera-to-body delta back to metres before screen-error and horizon calculations. Model matrices, camera vectors, orbit transforms, lighting vectors and occluder positions must preserve this contract.
