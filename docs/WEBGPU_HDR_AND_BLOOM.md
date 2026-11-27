# WebGPU HDR and Bloom pipeline

The active native WebGPU renderer keeps scene color in an `rgba16float` render target and applies post-processing before presenting to the canvas.

## Pipeline
1. Scene geometry, atmosphere/cloud shells, rings and orbits render into the linear floating-point scene target.
2. Bright-pass extraction uses Rec.709 luminance and a soft-knee threshold to avoid a harsh cutoff around bright pixels.
3. A separable five-tap Gaussian blur runs horizontally and vertically at half resolution.
4. The active `bloomIterations` profile setting controls 1–8 additional blur pairs. Each later pair reuses ping-pong targets to widen the glow without allocating per-frame textures.
5. Composite adds bloom to the HDR scene, then applies exposure and the selected Reinhard or ACES tone curve.
6. Gamma encoding is applied once at final presentation. Glare and lens flare are composited before tone mapping and obey their own profile toggles/strengths.

## Quality and safety
- Bloom threshold, strength, exposure, HDR, tone operator, glare and lens flare come from the active GraphicsSettings object on each rendered frame.
- Blur texel offsets are calculated in the half-resolution bloom target's pixel space, not the full-resolution scene space.
- Bloom iteration count is clamped to 1–8 to bound GPU work.
- Disabling Bloom skips bright extraction and blur passes and sets composite bloom strength to zero.
- The current implementation uses a half-resolution bloom target and repeated separable Gaussian passes; it is not a multi-resolution mip/pyramid bloom.
- HDR is a floating-point scene pipeline, not an HDR monitor output or OS-level HDR presentation mode.
- Final browser visual tuning (halo radius, threshold and exposure across scene distances) remains part of the combined visual review after item 13.
