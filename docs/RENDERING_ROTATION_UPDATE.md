# Rendering, illumination and rotation update

## Surface LOD and storage

- Projected radius is calculated in effective render-target pixels, so renderScale and display pixel density participate in LOD selection.
- High and Ultra texture presets may request 2048 texels on each Cube Map face. Low is capped at 512 and Medium at 1024.
- The map generator accepts resolutions through 4096 so a future 4K tier does not require changing its public data model.
- Albedo: RGBA8 at requested LOD (up to 2048 in current presets). Normal: RGB8 capped at 1024. Height and Roughness: R8 each, capped at 512.
- Mipmaps are generated for all four cube textures. Anisotropic filtering is enabled when EXT_texture_filter_anisotropic is available, capped at 8x.
- CPU cache budget: 192 MiB. GPU cache budget: 256 MiB. A 2048 albedo cube map plus smaller material maps and mipmaps fits the current budget. A future 4096 tier requires an increased GPU budget or streaming/compression policy.
- The focused body is requested at maximum priority. The 64-face preview remains visible while higher LOD is generated and uploaded in two cube faces per frame. The previous LOD remains bound during replacement.
- Texture coordinates and normal-map vectors are sampled in local body space, then normals are transformed by the body model matrix. Albedo, relief and cloud patterns therefore rotate with the body.

## Lighting

The surface shader evaluates direct stellar irradiance with inverse-square attenuation in the scene's AU coordinate frame. The primary star intensity is calibrated so that the solar irradiance factor at 1 AU is 1.

Camera exposure adapts smoothly to the Sun distance of the focused body:

exposure = userExposure × clamp(distanceToSunAU², 1, 900)

This is exposure compensation, not a change to the physical light source. Direct-light calculation retains its inverse-square law and the night side still receives only the small indirect-light floor. HDR/ACES maps the compensated range to the display. Exposure follows focus with a 450 ms exponential response.

This is a display-oriented adaptation, not a fully calibrated photometric camera. It is capped at 30 AU and does not solve exposure selection for every possible multi-star procedural system.

## Labels

Body labels use the same smooth distance curve as heliocentric orbit fading, inverted: they are fully visible nearby and fade out as the camera moves away. The curve is evaluated per body using camera-to-body distance divided by body radius. Orbit and label settings remain separate.

## Rotation model

CelestialBody now carries optional SI rotation metadata:
- rotationPeriodSeconds: sidereal period, stored as a positive duration.
- axialTiltRad: obliquity relative to that body's orbital plane.
- rotationDirection, primeMeridianRad and rotationEpochSeconds: phase and spin direction.
- tidalLock: synchronous orientation toward the parent body.
- solarDaySeconds: solar-day duration, separate from sidereal rotation.
- Optional equatorial radius, atmospheric composition and ring-presence metadata.

Free rotation is evaluated analytically from PhysicsWorld.simulationTimeSeconds. It therefore follows time scale and pause and does not accumulate frame-step drift. The eight planets and Sun use the J2000 IAU pole right ascension/declination and prime-meridian W0; the equatorial pole vector is transformed into the simulation's J2000 ecliptic frame. The sign of Wdot is retained for retrograde rotators. For bodies without a pole solution, the model falls back to the orbital angular-momentum vector and an explicitly stored obliquity. Synchronous moons derive their orientation from the instantaneous parent direction and orbital normal; they are not spun at an arbitrary independent rate. Cloud texture coordinates use local body coordinates and follow the same body transform.

The Solar System fixture uses JPL sidereal periods for the eight planets. Venus and Uranus are represented by obliquities greater than 90 degrees; the positive spin period is measured around the defined north pole, so the pole orientation carries the retrograde sense. The Sun uses an approximate equatorial rotation period.

Regular modeled satellites are marked synchronous; their displayed spin period is derived from the same Keplerian semi-major axis and parent GM used by the orbit model. Phobos and Deimos are known synchronous rotators. Hyperion, Phoebe, Himalia and Nereid are deliberately left without a fabricated spin period. Satellite pole obliquities are not invented where the model has no reliable pole solution.

## Astronomical data and interpretation

- Planet masses, mean/equatorial radii and sidereal rotation periods: JPL Planetary Physical Parameters.
- Planetary orbital starting elements: the project's existing JPL approximate J2000 secular-element fixture. They remain a compact Keplerian approximation, not a Horizons ephemeris.
- Satellite masses/GM and mean radii: JPL Planetary Satellite Physical Parameters.
- Satellite mean orbital elements: JPL Satellite Mean Elements. JPL explicitly warns that these mean elements are not intended for precise ephemeris computation.
- Planet solar-day durations and familiar physical summaries: NASA Planetary Fact Sheet.
- Axial pole and prime-meridian orientation: IAU Working Group report (J2000 pole RA/Dec and W0/Wdot). The stored obliquity values are rounded to the NASA educational reference table.
- Satellite synchronous rotation: NASA/NSSDC satellite fact sheets and cited JPL/NASA rotation literature. Where only synchronous state is used, the simulation derives the period from the orbit rather than duplicating a second period constant.

Environment values stored in the Solar System fixture are representative rounded values. For gas/ice giants, 1 bar is a reference pressure level, not a solid surface pressure. Giant-planet temperatures refer to representative atmospheric levels. The UI only displays temperature/pressure when the fixture contains an explicit value; it does not substitute generic Earth values.

This project does not yet model IAU pole right ascension/declination, time-varying pole precession, libration, physical atmosphere differential rotation, Hyperion's chaotic tumbling, or a full N-body orientation ephemeris. A synchronous satellite is visually parent-facing with its orbital normal as the spin axis; it is not a full physical libration model.

## Verification boundaries

Automated tests cover per-channel byte layouts and deterministic cube-map generation, 2K LOD selection and the 4K-capable generator input contract, label fade curve, local-space surface/cloud sampling and normal transformation, analytic spin phase, obliquity metadata, synchronous moon state, and unknown-spin cases.

CI does not launch the browser's complete WebGL scene. Visual seam inspection, high-LOD GPU memory, real 2K generation latency, exposure appearance on outer planets, cloud/texture rotation and long-session resource pressure require manual browser validation on the target GPU.

## Sources

- JPL Planetary Physical Parameters: https://ssd.jpl.nasa.gov/planets/phys_par.html
- NASA Planetary Fact Sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/
- JPL Planetary Satellite Physical Parameters: https://ssd.jpl.nasa.gov/sats/phys_par/
- JPL Planetary Satellite Mean Elements: https://ssd.jpl.nasa.gov/sats/elem/
- NASA Jovian Satellite Fact Sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/joviansatfact.html
- NASA/JPL report on Phobos and Deimos rotation: https://ntrs.nasa.gov/citations/20000057402
- IAU 2009 pole/prime-meridian rotation elements: https://aa.usno.navy.mil/downloads/reports/Archinaletal2011a.pdf
- NASA HEAT axial tilt reference: https://assets.science.nasa.gov/content/dam/science/hpd/heat/teacher-lessons/Why%20Do%20We%20Have%20Seasons_%20by%20Tanya%20Anderson_0.pdf