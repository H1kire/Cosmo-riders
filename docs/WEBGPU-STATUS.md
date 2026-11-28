# WebGPU renderer — implementation and verification status

Last repository audit: 2026-11-28
Audited branch: `test`
Audited code commit: `2b2b77f42f3cf75464675649b262f82df70a111c`

## Active renderer

The application uses the native WebGPU renderer as its only graphics backend. The active scene is assembled by `src/presentation/solar-3d.ts` and submitted to `WebGPUBackend.render(WebGPUFrame)`. Physics remains the source of truth for body positions, velocities, orbital state, simulation time and rotation.

There is no WebGL2 runtime fallback. If WebGPU initialization or device recovery fails, the application reports that WebGPU is unavailable rather than silently switching to a different renderer.

The older WebGL2 geodesic and ring renderers, GLSL materials, and cube-map surface generator are not part of the active frame path. See `src/rendering/README.md` for the active architecture and coordinate contracts.

## Implemented in the active WebGPU path

- Native adapter/device initialization, WGSL compilation checks, canvas configuration, device-loss reporting and recovery handling.
- Live simulation body transforms, camera-relative render coordinates, orbit paths and simulation-driven rotation.
- Geodesic solid-body surfaces based on 20 icosahedron root faces, screen-space Quadtree LOD, 2:1 balancing, edge stitching and bounded mesh/page caches.
- Five procedural geological channels: albedo, normal, physical height in metres, roughness and material ID.
- Worker-based surface and mesh generation, progressive GPU page initialization/uploads, shared cache budgeting and visible-page prioritization.
- Parent/child LOD transitions with fragment-level color blending, parent coverage while child resources load, and a separate final depth pass.
- Gas/ice giant direction-space band and storm shading.
- Atmospheric Rayleigh/Mie single-scattering approximation and independently configured cloud shells with bounded volumetric density integration.
- Planet/moon finite-disc eclipse approximation, analytical terrain/atmosphere shadows, ring illumination and ring shadows on host planets.
- Linear floating-point scene target, bloom extraction/blur, exposure, Reinhard/ACES tone mapping, glare and lens-flare composition.
- Graphics presets, render scale, MSAA negotiation and adaptive quality controls.
- Deferred retirement of GPU meshes and render targets until submitted queue work has completed.
- Shared surface-page budgeting reserves the 20 root-face pages required by every later visible solid body before allowing higher-priority planets to consume additional LOD pages.
- If the current and target LOD coverages cannot coexist within the shared GPU budget, the renderer retains the current complete coverage and retries the LOD change later instead of dropping the old surface before the new pages are ready.

These are implemented rendering systems and approximations; they are not claims of physically complete climate, radiative-transfer or shadow-map simulation.

## Automated verification

The current `test` head is `f139116d324cccdb8487a42562829839b6d3968a`.

GitHub Actions run [46135762431](https://github.com/H1kire/Cosmo-riders/actions/runs/46135762431), completed 2026-11-28 with conclusion **success**. The workflow ran the Rust computational tests, built the WASM package, installed dependencies, executed the complete repository audit, published the Pages artifact and passed the live Pages/MIME check.

This verifies the CI build/test/audit pipeline and the live Pages/MIME smoke check for that commit. It does not establish visual correctness of the rendered scene on a physical browser/GPU.

## Remaining acceptance work — not marked complete

1. Perform a real browser/WebGPU visual review of the complete Solar System, including near-surface and distant views.
2. Verify tile seams, 2:1 edge stitching, parent coverage, crossfade continuity, depth ordering and temporal stability while the camera moves and zooms.
3. Inspect surface sharpness and physical relief at multiple altitudes for every solid-body profile; verify all five channels are sampled consistently.
4. Tune and compare solar exposure and color response for inner planets, gas giants, ice giants, moons and the night side.
5. Inspect atmosphere silhouettes, cloud layering/wind, gas-giant bands/storms, rings, eclipses and ring shadows at multiple viewing angles.
6. Measure frame pacing, CPU/backend encode time, GPU time, upload spikes and memory/cache pressure at distant, orbital and close-up camera distances.
7. Verify each graphics preset and adaptive-quality transition on representative WebGPU hardware.

The repository's current environment does not provide evidence for these browser/GPU visual acceptance checks. They must remain explicitly pending until a real runtime review is performed. Do not describe the graphics overhaul as fully visually verified based only on CI.

## Known technical limits

- Surface geology is deterministic procedural generation, not a geological evolution simulation.
- Atmospheric rendering is a bounded single-scattering approximation, not full multiple scattering or spectral radiative transfer.
- Clouds are bounded view-ray integrations over spherical layers, not a weather or fluid simulation.
- Planetary, eclipse and ring shadows are analytical approximations; cascaded shadow maps are not implemented.
- The planetary catalogue uses J2000 mean elements and a hierarchical two-body approximation, not a DE440/Horizons ephemeris integration.
- WebGPU does not expose a portable physical VRAM usage counter; cache allocation diagnostics are estimates derived from texture descriptors.

## Branch safety

All work for this graphics revision must remain on `test`. Do not modify or merge into `main` as part of this task.
