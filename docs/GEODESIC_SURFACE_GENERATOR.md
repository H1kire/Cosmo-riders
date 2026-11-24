# Geodesic Surface Generator

## Status

The geodesic generator is an implemented CPU/Worker-side foundation. It is not yet the active planetary renderer. Solar3DView still renders the procedural GLSL material on UV sphere meshes. The previous Cube Map generator is retained temporarily because renderer migration and regression tests are not complete.

## Geodesic hierarchy

Planet → 20 icosahedron base faces → four children per face → recursive triangular patches.

icosphere.ts stores twelve normalized icosahedron vertices and twenty triangular faces. A tile is identified by a base-face index and a child path consisting of digits 0..3. Each subdivision normalizes edge midpoints onto the unit sphere and creates four child triangles.

For triangle vertices A, B, C and barycentric coordinates (u, v), the spherical direction is:

 D(u,v) = normalize((1-u-v)A + uB + vC)

There is no global equirectangular UV map and no cube-face projection. Shared edge directions are evaluated from the same endpoint pair and agree geometrically.


## Geodesic topology and edge neighbors

The base icosahedron now exposes its twelve indexed vertices, twenty indexed faces and a reciprocal face-edge adjacency table. An edge is identified by the unordered pair of original vertex indices; the table records the neighboring face, its local edge index (AB, BC or CA), and edge orientation. Construction validates that every one of the thirty undirected edges has exactly two incident faces.

For active patches, `tile-neighbors.ts` compares only tiles belonging to the same base face or to topologically adjacent base faces. It detects coincident great-circle edge intervals, including a fine edge contained in a coarser neighbor edge. Neighbor links are returned in both directions and preserve the local edge indices. This is a geometric interval query over the active leaf set, not a persistent O(1) edge-addressing structure; the current implementation still performs pairwise candidate comparisons within each adjacent face group.

## Extended triangular grid and gutter allocation

`buildTileDirections()` visits rows from `-g` through `n+g` and columns from `-g` through `n+g-row`. The exact vertex count is therefore:

```text
(n + 2g + 1) * (n/2 + 2g + 1)
```

The output allocation uses this derived count and verifies the final write offset. This is deliberately not the ordinary triangular-lattice count: the gutter loop includes rows and columns outside the original triangle. Tests exercise gutter widths 0, 1, 2, 3 and 8 and validate every written direction.

## Conservative planetary horizon culling\n\n`quadtree-selector.ts` now evaluates the maximum possible camera-direction dot product over the tile's spherical cap. For center angle \\(\\theta\\) and cap radius \\(\\alpha\\), the upper bound is 1 when \\(\\theta\\le\\alpha\\), otherwise \\(\\cos(\\theta-\\alpha)\\). A tile is rejected only when this upper bound is below \\(R/D\\), where \\(R\\) is body radius and \\(D\\) is camera distance from the body center. The test suite covers front/back, tangent, large caps, low/high altitude and camera positions at or inside the body.\n\n## Adaptive geodesic LOD

`quadtree-selector.ts` evaluates each candidate patch in body-local coordinates. It estimates angular patch radius from the normalized triangle centroid, computes spherical sagitta error, projects that error using the viewport focal length and camera-to-patch distance, and applies a pixel-error threshold. It also performs conservative view-frustum and planetary-horizon rejection. A previous split-key set provides split/merge hysteresis; when the camera moves away, the recursive selection naturally returns parent leaves. Maximum depth and active leaf budget are explicit limits.

`quadtree-balancer.ts` checks actual neighboring edge intervals and splits the coarse side until adjacent active leaves differ by at most one level, subject to maximum depth and tile budget. Diagnostics report checked neighbor pairs, split operations, maximum remaining level difference, violations, iterations and budget limitation. The present balancer recomputes the active neighbor map after each refinement pass; it is correct for the current bounded patch sets but is not yet an incremental per-edge update queue.

## Persistent per-planet active leaf state\n\n`geodesic-surface-runtime.ts` introduces independent CPU state per planet. It owns active leaves, visibility flags, priorities, current neighbor links and computed stitch masks. Split replaces a parent with its four children and applies 2:1 balancing; Merge requires all four active children and rejects a replacement that would violate 2:1. Visibility is stored separately and never removes leaves from the topology. Reconciliation accepts a complete desired leaf cover and validates that it is an antichain before balancing.\n\nThe runtime currently rebuilds the complete neighbor map after a mutation. Its statistics expose updated tile count, changed links, edge comparisons, recomputed masks, full rebuild count and elapsed CPU time. This is a persistent state manager, but it is **not yet an incremental edge-index implementation**; the counters deliberately make full rebuilds visible rather than presenting them as incremental work.\n\n## Stitching and indexed mesh construction

`tile-stitching.ts` defines three edge bits (AB=1, BC=2, CA=4) and caches all eight coarse-neighbor masks per even mesh resolution. For each mask it omits odd boundary samples on coarse-neighbor edges, then incrementally inserts every retained triangular-grid point into a planar triangulation. Points lying on an existing edge split all incident triangles, avoiding T-junctions. The algorithm preserves the complete triangular domain rather than collapsing boundary vertices into the interior.

`tile-mesh.ts` uses the resulting index template with normalized geodesic directions and physical positions `direction * radiusM`. Radius and positions are expressed in SI metres. Stitch templates are currently limited to even resolutions from 2 through 64 to bound one-time CPU work and are cached by resolution and mask.

Automated tests validate all eight masks for in-range indices, positive winding, non-degenerate triangles, boundary parity, edge incidence counts and preservation of the full triangular area. They also validate outward winding and physical radius for generated sphere meshes.

## Geological profiles

surface-profile.ts converts CelestialBody physical inputs into an immutable generation profile. It uses surfaceSeed when present and otherwise derives a deterministic seed from body ID. The profile carries mass, radius, calculated gravity, temperature, pressure, water/ice/iron/silicate/volatile fractions, tectonic and volcanic activity, erosion, age and rotation period.

Known Solar System bodies have explicit starting presets. Unknown bodies are classified using coarse physical heuristics (density, radius, temperature, pressure and volatile fractions), with explicit body surface metadata taking precedence. These are procedural visual profiles, not a full geochemical or climate simulation.

## Geological tile generation

surface-tile.ts evaluates a direction-space geological field. The current implementation includes deterministic spherical plate centers, plate identity and boundary distance, continental/oceanic elevation contrast, tectonic uplift and trench depression, erosion and gravity scaling, and distinct rocky, oceanic, desert, icy and volcanic material families.

Jupiter, Saturn, Uranus and Neptune use dedicated zonal atmosphere fields. Atmospheric giants return zero solid height and a cloud material ID.

Each tile produces independent typed-array channels: RGBA8 albedo, RGB8 normal, Float32 height in metres (the dimensionless geological relief amplitude is converted using the body's physical mean radius), R8 roughness and R8 material ID. A square page is mapped to the complete triangle with the bijective interior mapping q = sqrt(x), u = q(1-y), v = qy; the inverse is x = (u+v)^2, y = v/(u+v), with the triangle apex handled as a single limiting point. Gutter texels continue the same parameterization outside the page and evaluate the same global direction-space field rather than clamping samples to the nearest point of the triangle. Height-derived normals use central differences in a local spherical tangent basis, so the normal field is evaluated from the same direction-space height function on every tile.

## Worker pool and caches

surface-worker-pool.ts runs generation only in module Workers. Concurrency defaults to a conservative cap derived from navigator.hardwareConcurrency and is limited to four. Requests are keyed by a stable JSON serialization of the body identity, request seed, every physical/profile field, algorithm version, tile face/path/level, resolution and gutter. This avoids reusing a page after physical profile changes under the same seed. The serialized identity is intentionally retained rather than relying on a lossy short hash. Higher-priority queued work is scheduled first. An unavailable Worker produces a controlled error; it does not run the full generator synchronously on the UI thread.

virtual-surface-manager.ts tracks request states and maintains a bounded CPU LRU cache. Its GPU page cache uses WebGL2 TEXTURE_2D_ARRAY resources and LRU layer reuse for albedo, normal, height, roughness and material ID. Memory is bounded by the requested budget and MAX_ARRAY_TEXTURE_LAYERS.

## Current limitations / migration gates

The current maintenance pass also fixed two independent issues: cache identity now includes the complete physical profile, and the body-label renderer now applies the already-computed distance opacity instead of forcing opacity to 1. These changes do not constitute geodesic renderer integration.

1. The tile generator, Worker pool and caches are not yet wired into Solar3DView.
2. The renderer still uses the old procedural surface fragment shader and UV sphere geometry.
3. The selector, active-leaf runtime, neighbor search, 2:1 balancer and stitch templates are CPU-side components. The runtime computes masks from all neighbor links on each topology rebuild, but it is not yet connected to Solar3DView or used to draw planets.
4. Neighbor lookup still uses pairwise edge-interval comparisons within adjacent base-face groups. The runtime also rebuilds the complete neighbor map after Split/Merge; a persistent hierarchical edge index and incremental update queue remain future work.
5. Stitch masks are automatically derived from every neighbor link and cached index templates are requested when a mask changes. Paired cross-face seam tests over actual position/index buffers and displacement-height continuity are still required; rendered seam behavior has not been verified.
6. The gutter direction grid is tested for full writes and normalized directions. Cross-page texture filtering continuity for neighboring LOD pages has not yet been proven in the GPU sampler.
7. No browser GPU timing, VRAM measurement or 2K/4K visual benchmark has been recorded.

These are explicit remaining work items, not claimed features.

## Подготовка GPU-страниц и атрибутов меша (аудит 2026-11-24)

- GeodesicTileMesh тепер формує радіальні нормалі та textureCoordinates для кожної вершини. UV обчислюються через обернене перетворення triangleToSquareUv, обернене до squareToTriangleBarycentric генератора сторінок.
- SurfaceGpuPageCache враховує 13 байт на тексель для п'яти каналів (RGBA8, RGB8, R32F, R8, R8), встановлює UNPACK_ALIGNMENT=1 на час завантаження та відновлює попереднє значення навіть у разі помилки.
- Додано pin, unpin та isPinned. LRU пропускає закріплені шари та повідомляє про вичерпання доступних шарів, якщо всі вони закріплені.
- Runtime тепер розрізняє стан «видимість ще не задавалася» та явний порожній набір видимих листків.

Обмеження: нормалі меша поки радіальні, а не обчислені з displacement height; UV/сторінка ще не підключені до GLSL. Pin API існує, але виклики pin/unpin ще не пов'язані з життєвим циклом кадру в Solar3DView. Інкрементальний edge index, реальний geodesic draw path, Worker → GPU pipeline та браузерна перевірка залишаються незавершеними.
