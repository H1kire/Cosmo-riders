# WebGPU shadows, eclipses and ring lighting

The active WebGPU scene now evaluates finite-disc occlusion per shaded fragment.

## Planet and moon shadows
- Up to eight nearby foreground bodies are selected from the live simulation scene and supplied in camera-relative AU coordinates with physical radii.
- The shader compares apparent angular radii and angular separation of the Sun and each caster, then evaluates analytic circle overlap. Partial eclipses therefore produce a penumbra instead of dimming an entire planet by one center-sampled scalar.
- The same finite-disc visibility is used by the conventional WebGPU sphere/effect shader and the geodesic tile shader.
- Atmospheric scattering and volumetric cloud lighting reuse the per-fragment visibility function.

## Ring lighting
- Ring fragments receive the live Sun position and the same scene occluder list.
- Ring illumination uses the absolute incidence angle to the ring plane, ambient fill and finite-disc shadows from the parent planet and other foreground bodies.
- The planet shader intersects each sunlight ray with the host ring plane and applies a radial optical-depth approximation, so rings cast structured shadows back onto their parent planet.

## Units and limitations
- Scene positions, ring radii, caster radii and solar radius are consistently expressed in AU in the GPU shaders.
- Occluder selection remains bounded to eight casters per body to control per-fragment cost.
- The analytic overlap uses angular circular discs, not a full volumetric penumbra integration. Ring opacity and radial structure are artistic approximations based on the current ring profiles.
- Shadow-map cascades and physically resolved atmospheric multiple-scattering shadows are not implemented in this step.
- Browser visual tuning is intentionally deferred until the combined review after item 13; this item is validated by automated tests, WGSL compilation in CI and the full repository audit.
