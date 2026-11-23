# Procedural Planetary Surface System

## Scope

The surface pipeline produces deterministic cube-map material data for rocky bodies and atmospheric giants. All surface coordinates are sampled as normalized 3D directions, avoiding longitude/latitude singularities and keeping adjacent cube-face samples in the same directional domain.

## Generation model

- `surfaceSeed` selects the deterministic noise fields. If a body has no explicit seed, the stable body identifier is hashed.
- `CelestialBody.surface` supplies the physical and geological profile: class, temperature, pressure, water/ice, mineral fractions and composition, tectonics, volcanism, impact age, erosion and rotation.
- The profile selects a distinct relief model: impact-dominated airless terrain, continental/oceanic crust, aeolian dunes, fractured ice, volcanic cones/fissures, Titan-like organic terrain, or Venus-like volcanic plains.
- Gradient Perlin fBm is used for broad geological structure; value-noise fBm, ridged multifractal fields, Worley cells and domain warping provide regional and fine structure.
- Gas and ice giants use an atmospheric field model. Banding, turbulence, vortices and haze are parameterized by rotation, temperature, volatile abundance and hydrocarbon abundance rather than by body display name.
- Material channels use independent resolutions and compact formats: RGBA8 Albedo, RGB8 Normal, R8 Height and R8 Roughness. Albedo follows the selected LOD up to 2048 texels per cube face in current presets; Normal is capped at 1024 and Height/Roughness at 512. Gas/ice giants receive zero geological height and radial normals.

## Streaming and resource policy

- One dedicated Web Worker handles CPU map generation; the main thread does not run the normal browser generation path.
- The Worker transfers the four typed-array buffers rather than cloning them.
- Requests are deduplicated by profile fingerprint, algorithm version and resolution, and queued by priority. Focused bodies receive the highest priority; visible bodies are weighted by projected size and screen-center proximity.
- A 64-texel base map is requested before a larger target map when no base GPU map is available. High/Ultra presets may request 2048 texels per face; Medium is capped at 1024 and Low at 512. The higher LOD is generated while the base map is uploaded and displayed. LOD selection uses projected body radius in the effective render-target pixel grid.
- GPU uploads are incremental: at most two cube faces per frame, with mipmap generation spread across frames. The previous available LOD remains bound until the new LOD is ready; replacement is blended over 450 ms.
- CPU LRU cache budget: 192 MiB. GPU texture budget: 256 MiB. GPU entries are evicted by least-recent use. Mipmaps are included in the GPU reservation estimate; anisotropic filtering is enabled up to 8× when supported.

## Diagnostics

`Solar3DView.getSurfaceDiagnostics()` exposes Worker state, CPU/GPU cache bytes, cache entries, queued CPU/GPU jobs, pending generations, last generation duration, GPU command-submission duration, and frame-time estimates.

`lastGpuSubmissionMs` measures CPU-side WebGL command submission, not actual GPU execution time. Actual GPU timing requires timer-query support and separate instrumentation.

## Known limits

- This is a physically informed procedural visual model, not a climate, tectonic or geochemical evolution simulator.
- It does not ingest scientific elevation/imagery rasters; named-world profiles are curated presets.
- Current maps use 8-bit channels. Higher-precision height formats are not yet implemented. The generator accepts 4096 as a future albedo resolution, but the current graphics presets stop at 2048 and the 256 MiB GPU budget is not sized for a complete 4096 set.
- Atmospheric giant maps are generated as static deterministic patterns; they do not model fluid dynamics or time-evolving weather.
- Worker generation is serialized through one Worker. Priority affects queued jobs but cannot preempt a job already executing.
- A 2048 map is still a substantial CPU/VRAM allocation; the focused body gets the highest priority and lower-resolution previews remain visible while it is generated. No benchmark claims are made without measurements on a specified browser, GPU and scene. CI checks logic and build contracts; visual seam checks, GPU timing, frame-time comparison and memory-pressure behavior still require browser testing.
