# Geodesic Surface Generator

## Status

The geodesic generator is an implemented CPU/Worker-side foundation. It is not yet the active planetary renderer. Solar3DView still renders the procedural GLSL material on UV sphere meshes. The previous Cube Map generator is retained temporarily because renderer migration and regression tests are not complete.

## Geodesic hierarchy

Planet → 20 icosahedron base faces → four children per face → recursive triangular patches.

icosphere.ts stores twelve normalized icosahedron vertices and twenty triangular faces. A tile is identified by a base-face index and a child path consisting of digits 0..3. Each subdivision normalizes edge midpoints onto the unit sphere and creates four child triangles.

For triangle vertices A, B, C and barycentric coordinates (u, v), the spherical direction is:

 D(u,v) = normalize((1-u-v)A + uB + vC)

There is no global equirectangular UV map and no cube-face projection. Shared edge directions are evaluated from the same endpoint pair and agree geometrically.

## Geological profiles

surface-profile.ts converts CelestialBody physical inputs into an immutable generation profile. It uses surfaceSeed when present and otherwise derives a deterministic seed from body ID. The profile carries mass, radius, calculated gravity, temperature, pressure, water/ice/iron/silicate/volatile fractions, tectonic and volcanic activity, erosion, age and rotation period.

Known Solar System bodies have explicit starting presets. Unknown bodies are classified using coarse physical heuristics (density, radius, temperature, pressure and volatile fractions), with explicit body surface metadata taking precedence. These are procedural visual profiles, not a full geochemical or climate simulation.

## Geological tile generation

surface-tile.ts evaluates a direction-space geological field. The current implementation includes deterministic spherical plate centers, plate identity and boundary distance, continental/oceanic elevation contrast, tectonic uplift and trench depression, erosion and gravity scaling, and distinct rocky, oceanic, desert, icy and volcanic material families.

Jupiter, Saturn, Uranus and Neptune use dedicated zonal atmosphere fields. Atmospheric giants return zero solid height and a cloud material ID.

Each tile produces independent typed-array channels: RGBA8 albedo, RGB8 normal, Float32 height, R8 roughness and R8 material ID. Tiles are square GPU pages with a gutter. Samples outside the triangular domain are clamped to the triangle domain for a stable border.

## Worker pool and caches

surface-worker-pool.ts runs generation only in module Workers. Concurrency defaults to a conservative cap derived from navigator.hardwareConcurrency and is limited to four. Requests are deduplicated by planet seed, algorithm version, face/path, resolution and gutter. Higher-priority queued work is scheduled first. An unavailable Worker produces a controlled error; it does not run the full generator synchronously on the UI thread.

virtual-surface-manager.ts tracks request states and maintains a bounded CPU LRU cache. Its GPU page cache uses WebGL2 TEXTURE_2D_ARRAY resources and LRU layer reuse for albedo, normal, height, roughness and material ID. Memory is bounded by the requested budget and MAX_ARRAY_TEXTURE_LAYERS.

## Current limitations / migration gates

1. The tile generator, Worker pool and caches are not yet wired into Solar3DView.
2. The renderer still uses the old procedural surface fragment shader and UV sphere geometry.
3. There is not yet a camera-frustum patch selector, quadtree balancing, GPU page-table shader lookup, parent-page fallback, or parent/child crossfade.
4. Stitch index buffers for mixed-resolution patch boundaries are not yet connected to the renderer.
5. The current normal estimate is an initial implementation and requires visual seam and tangent-frame validation.
6. No browser GPU timing, VRAM measurement or 2K/4K visual benchmark has been recorded.

These are explicit remaining work items, not claimed features.