# WebGPU atmospheric scattering

The active WebGPU body-effect pass evaluates a bounded single-scattering approximation for atmospheric shells.

- Rayleigh scattering uses wavelength-dependent RGB coefficients and the Rayleigh phase function.
- Mie scattering uses a Henyey–Greenstein phase function with clamped anisotropy.
- Exponential Rayleigh and Mie density profiles use scale heights normalized by the body's physical mean radius.
- View-ray optical depth is accumulated with the configured 2–16 samples; sunlight optical depth is estimated with four fixed samples per view sample.
- Planetary ground occultation and the renderer's existing body-shadow visibility attenuate direct sunlight.
- The output remains linear HDR radiance in the existing rgba16float scene target and uses the current alpha-composite effect pass.

Scale-height ratios and atmospheric thickness are supplied from each body's atmosphere profile in SI metres. The GPU shader receives ratios only after conversion against the body's mean radius, so the ray marcher operates consistently in the scene's AU-scaled coordinates.

This is a real-time single-scattering approximation, not a full multiple-scattering or spectral radiative-transfer solver. Browser visual tuning and validation are intentionally deferred to the final graphics review.
