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

Atmospheric scattering integrates optical depth along the view ray with a quality-dependent sample count. Cloud shells use animated procedural FBM and per-layer wind. Planetary shadowing tests the surface-to-star ray against nearby celestial occluders, including moons; the soft edge approximates the penumbra from the apparent stellar angular radius. This is an analytic planetary shadow method rather than a single shadow map spanning the entire astronomical scene.

The HDR compositor extracts bright pixels, performs configurable blur iterations, and then adds glare and lens-flare elements at the projected solar position. Solar visibility for optical effects is reduced by analytic occultation.

## Quality profiles

Low through Ultra change internal render resolution, mesh LOD ceiling, atmosphere integration samples, cloud detail, number of shadow occluders, bloom iterations and intensity, optical effects, and HDR target format. HDR targets use RGBA16F when `EXT_color_buffer_float` is available; disabling HDR recreates the targets in RGBA8. The renderer upscales the internal scene to the canvas resolution in the final composite.

## Coordinate contract

Physics remains SI. Rendering consumes camera-relative coordinates in the existing renderer convention. Unit conversion occurs only at the presentation boundary.

## Compatibility

The new rendering systems preserve the legacy `LightingEngine` point-light sampling API. The physics core remains independent of rendering code.
