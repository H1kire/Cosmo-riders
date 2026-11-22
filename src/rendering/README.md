# Cosmo-riders Visual Engine 0.2

The rendering layer is independent from the physics core. It consumes camera-relative render snapshots and must never change orbital state, SI units, SOI transitions, or simulation time.

## Target render order
1. Scene geometry and material pass
2. Shadow maps and analytic eclipse visibility
3. Atmospheric scattering and cloud layers
4. HDR emissive sources and stellar corona
5. Bloom extraction and blur
6. Glare and lens flare
7. Tone mapping and final composite

The current branch establishes typed contracts, resource ownership, configuration, compatibility adapters, and initial analytic utilities. GPU effects that are still placeholders are explicitly marked in their source files; they are not considered visually implemented yet.

## Coordinate contract
Physics remains SI. Rendering consumes camera-relative coordinates in the existing renderer convention. Unit conversion occurs only at the presentation boundary.

## Compatibility
LightingSystem extends the existing LightingEngine, preserving its point-light sampling API while adding typed light-source descriptors.

## Quality profiles
Low, Medium, High, and Ultra are defined in quality-settings.ts. The graphics settings panel persists selections locally and dispatches graphics-settings-change. The current renderer does not yet consume every setting; integration is a later implementation step.
