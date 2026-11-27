# Gas giant atmospheric rendering

The active WebGPU planet shader now has a dedicated direction-space gas giant atmosphere model.

- Jupiter, Saturn, Uranus and Neptune receive distinct stable profile IDs and independent zonal-band, storm-strength and jet-count controls from their live simulation body IDs.
- Surface bands combine several latitude frequencies, warped turbulence and fine zonal detail; the field is evaluated from a 3D unit direction, so it has no longitude seam.
- Storm masks use spherical angular distance and deterministic vortex turbulence rather than UV-space circles.
- Jupiter receives a large warm oval storm, Saturn receives a subdued polar hexagon treatment and smaller storm field, Uranus receives low-contrast storm structures, and Neptune receives a dark atmospheric spot.
- Layered cloud shells inherit the parent gas giant's profile, so cloud density and tint respond to the same storm and band fields.
- Cloud decks retain independent altitude, thickness, wind and detail settings from the cloud system.
- All color calculations remain linear HDR and use the existing lighting, eclipse and cloud self-shadow paths.

The storm locations and palette controls are deterministic visual profiles, not a live meteorological model. Jet counts are profile metadata for future circulation refinement; the current shader approximates jets with bounded multi-frequency latitude fields. The final visual tuning remains deferred to the agreed combined browser review after item 13.
