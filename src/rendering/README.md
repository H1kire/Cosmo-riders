# Cosmo-riders Visual Engine 0.2

The rendering layer is independent from the physics core. It consumes camera-relative render snapshots and never changes orbital state, SI units, SOI transitions, or simulation time.

## Active render order
1. Shared solar-system geometry and material pass
2. Per-fragment celestial shadow visibility using ray/sphere intersections
3. Planet atmosphere shells with view-ray Rayleigh/Mie integration
4. Procedural cloud shells with animated FBM density and direct lighting
5. HDR bright extraction and separable Gaussian blur
6. Screen-space stellar glare and lens-flare ghosts
7. Exposure, ACES/Reinhard tone mapping, and final gamma conversion

## Shader architecture

`src/rendering/core/shader-library.ts` resolves reusable GLSL chunks and compile-time defines. `src/rendering/shaders/chunks.ts` contains shared math, procedural noise, lighting, scattering phase functions, cloud density, eclipse geometry, and tone-mapping functions. `src/rendering/shaders/planet-effects.ts` contains the active atmosphere and cloud GPU materials.

Atmospheric scattering integrates optical depth along the view ray with a quality-dependent sample count. Cloud shells use animated procedural FBM and per-layer wind. Planetary shadowing tests the surface-to-star ray against nearby celestial occluders, including moons; the soft edge approximates the penumbra from the apparent stellar angular radius. The shadows toggle also disables eclipse darkening in atmosphere and cloud materials. This is an analytic planetary shadow method rather than a single shadow map spanning the entire astronomical scene.

The HDR compositor extracts bright pixels, performs configurable blur iterations, and then adds glare and lens-flare elements at the projected solar position. Solar visibility for optical effects is reduced by analytic occultation.

## Quality profiles

Low through Ultra change internal render resolution, mesh LOD ceiling, atmosphere integration samples, cloud detail, number of shadow occluders, bloom iterations and intensity, optical effects, and HDR target format. HDR targets use RGBA16F when `EXT_color_buffer_float` is available; disabling HDR recreates the targets in RGBA8. The renderer upscales the internal scene to the canvas resolution in the final composite.

## Coordinate contract

Physics remains SI. Rendering consumes camera-relative coordinates in the existing renderer convention. Unit conversion occurs only at the presentation boundary.

## Compatibility

The new rendering systems preserve the legacy `LightingEngine` point-light sampling API. The physics core remains independent of rendering code.

## Planet surface materials

`src/rendering/shaders/planet-surface.ts` provides a dedicated surface material pass. It generates deterministic, sphere-space procedural maps for Earth (continents, oceans, deserts and polar ice), rocky bodies (crater fields and terrain variation), Mars (rust-colored geology), and the gas/ice giants (warped atmospheric bands and storm structure). The vertex stage adds restrained terrain relief, while the fragment stage uses distance-attenuated sunlight, analytic eclipse visibility, roughness-dependent GGX highlights, and a low night-side ambient term. The surface pass is independent of atmosphere and cloud shells, whose opacity is deliberately limited so they cannot wash out the underlying body.

These are procedural GPU materials, not downloaded photographic satellite maps. They are deterministic and do not require network access or external texture files at runtime.


## Surface, atmosphere, and lighting isolation

Planet surfaces are rendered by a dedicated surface program before optional atmosphere and cloud shell passes. Each body iteration explicitly rebinds the surface program after effect passes; effect toggles therefore cannot leave the next body's material uniforms targeting the wrong WebGL program. Surface albedo is generated in sphere-direction space (the current renderer does not load external bitmap/UV texture assets), avoiding UV seam and texture-fetch failure modes. Atmosphere and clouds are separate shell passes and their settings only gate those passes.

The surface shader supports up to four point lights per draw, evaluates each light direction and inverse-square attenuation per fragment in camera-relative AU coordinates, and keeps the first stellar source as the analytic shadow/penumbra source. Atmospheric scattering and cloud illumination also scale with the primary star's inverse-square irradiance. The indirect floor on unlit surfaces is intentionally very small to avoid making the night hemisphere appear emissive. Extra light sources currently contribute direct surface illumination; their individual occlusion volumes can be added without changing the material interface.

The solar renderer rebinds its surface program after optional passes. Shader objects are detached and deleted after linking; HDR targets are explicitly destroyed on resize and HDR mode changes, and the HDR pipeline exposes dispose() for renderer teardown.


The current sphere mesh intentionally carries positions and normals rather than UVs: the procedural surface maps are evaluated from normalized sphere-space directions, so they have no longitude seam and do not depend on bitmap loading or sampler state. The previous rendering defect was a GPU program-state leak between consecutive body passes, not a missing texture download. Deep-shadow surface ambient is kept near black; atmospheric twilight fades smoothly through the terminator, while clouds receive only direct stellar illumination.


## 2026 planet rendering audit

The sphere mesh has no UV attribute and the renderer does not load bitmap texture files. Planet surface maps are generated in the fragment shader from the interpolated unit-sphere normal, so the mapping is continuous across the longitude seam and does not depend on texture sampler state. Terrain octave frequencies are reduced with projected-size LOD to limit distant aliasing; relief detail is likewise reduced as the planet occupies fewer pixels.

The surface pass is independent of atmosphere/cloud toggles and is always drawn first with its own program and material uniforms. Atmosphere and cloud passes receive the same camera-relative occluder list but evaluate stellar-disc penumbra visibility at their own ray-march samples/fragments instead of applying one centre-of-planet eclipse value to the entire shell. The night-side atmosphere retains only a very small scattering floor; cloud illumination has no ambient emission. Surface stellar irradiance is normalized so the primary light intensity 22 corresponds to the reference flux at 1 AU, then falls with inverse-square distance.


## Full-resolution and close-range quality pass

The canvas backing resolution follows the element's CSS size and the device pixel ratio (capped at 2.0). The HDR scene target uses preset-controlled multisampling (Off on Low, 2× on Medium, up to 4× on High/Ultra) when supported, then resolves into its single-sample texture before bloom and tone mapping; if the GPU cannot allocate that target, rendering falls back to a depth-buffered regular HDR framebuffer. High and Ultra render the scene at native backing resolution; Low and Medium retain reduced internal scales as performance presets. HDR bright extraction runs at full scene resolution; only the broad blur ping-pong buffers are downsampled to 75% to keep the glow smooth without paying for multiple full-resolution blur passes. The scene, atmosphere, clouds, glare, and lens flare are composed at the full output size.

Planet meshes now have four geometric LODs, up to 128 latitude by 192 longitude segments. Selection uses projected pixel radius, not astronomical distance, and the shader's procedural terrain detail increases gradually with projected size. The current renderer still uses procedural sphere-space materials rather than bitmap texture assets: mipmaps and anisotropic filtering do not apply until image-based texture maps are introduced. No claim is made that the procedural maps are photographic satellite imagery.

Orbit paths use 512–1024 samples depending on orbital eccentricity. The WebGL2 canvas requests multisample antialiasing, and orbit lines use alpha blending. When a planet (or one of its moons) is selected, heliocentric orbit lines smoothly fade as the camera approaches the planet. With no selected body, the same fade follows the nearest heliocentric planet to the camera. Satellite orbit lines are excluded from that fade and remain independently visible. Celestial bodies are rendered in their normal body pass and are never hidden by the orbit-visibility rule.


Procedural terrain uses derivative-filtered fBm octaves (`fwidth`) to suppress noise frequencies smaller than a pixel. Texture-quality presets cap the shader detail independently from geometric LOD, so distant terrain does not pay for close-range detail and close views retain additional detail without uncontrolled aliasing.

Cloud density also filters its fine procedural noise by the fragment footprint, preventing high-frequency cloud detail from turning into shimmer or blocky aliasing at distance. Ultra atmosphere integration uses the shader's full 16-sample limit; High uses 10 samples.

## Procedural planetary surface generation

The renderer now uses the independent `procedural-surface/` subsystem for deterministic, composition-aware worlds.

- `noise.ts`: stable ID hashing, 3D value noise, fBm, ridged multifractal noise, cellular/Worley fields and domain warping.
- `surface-generator.ts`: physical surface profiles, geological sampling and six-face cube-sphere albedo, height/roughness and object-space normal maps. Sampling uses normalized 3D directions rather than equirectangular UVs, avoiding pole stretching and longitude seams.
- `surface-map-cache.ts`: asynchronous face-by-face generation and bounded CPU LRU storage.
- `solar-3d.ts`: screen-space map resolutions (64/128/256/512), cubemap upload, mipmap generation, gradual map blending and a separate 64 MiB GPU texture budget. GPU and CPU resources are released by `dispose()`.
- `planet-surface.ts`: combines the generated maps with analytic multifractal shading and the existing inverse-square multi-light / eclipse pipeline.

### Determinism and world metadata

A planet uses its explicit `surfaceSeed` when supplied; otherwise its stable celestial-body ID is hashed. Evaluation does not depend on body iteration order or frame count. New generated bodies can persist a `surfaceSeed` and `surface` metadata in `CelestialBodyOptions`, including surface class, temperature, pressure, water/ice/iron/silicate fractions, tectonic and volcanic activity, impact age and erosion.

Known Solar System bodies have curated starting profiles. Unknown bodies receive conservative gravity-based defaults, which can be overridden by their persisted surface metadata. These are procedural visual models, not a full climate or geochemical evolution simulation; missing composition is inferred rather than presented as measured science data.

### LOD and resource policy

Projected screen radius selects 64, 128, 256 or 512 texels per cube face. Lower-resolution maps remain usable while a higher level is generated; a newly uploaded level blends in over 450 ms. Cubemap mipmaps handle minification. CPU map memory is capped at 48 MiB and GPU cubemap memory at 64 MiB. Only bodies requested by the active renderer are generated, and GPU textures are evicted least-recently-used when the budget is exceeded.

The procedural generator is tested independently for seed stability, repeatability, physical profile differences, cube-map dimensions, output bounds and cache behavior in `tests/procedural-surface.test.ts`.
