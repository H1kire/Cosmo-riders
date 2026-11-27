# Solar System reference data

## Epoch and model
The planetary fixture is initialized at J2000.0 (2000-01-01 12:00 TT/TDB convention). It is a reproducible approximate Keplerian reference, not a substitute for JPL DE ephemerides or spacecraft navigation data.

## Planetary elements
The eight planets use the JPL Solar System Dynamics *Approximate Positions of the Planets* secular-element set (1800–2050 fit). The table lists semimajor axis in AU, eccentricity and inclination in degrees. Longitude fields are converted to the classical Ω, ω and M convention in `solar-system.ts`.

| Body | a (AU) | e | i (deg) |
|---|---:|---:|---:|
| Mercury | 0.38709927 | 0.20563593 | 7.00497902 |
| Venus | 0.72333566 | 0.00677672 | 3.39467605 |
| Earth | 1.00000011 | 0.01671022 | 0.00005 |
| Mars | 1.52371034 | 0.09339410 | 1.84969142 |
| Jupiter | 5.20288700 | 0.04838624 | 1.30439695 |
| Saturn | 9.53667594 | 0.05386179 | 2.48599187 |
| Uranus | 19.18916464 | 0.04725744 | 0.77263783 |
| Neptune | 30.06992276 | 0.00859048 | 1.77004347 |

## Physical parameters and Moon model
- Sun: mass 1.98847e30 kg; mean radius 695700000 m.
- Earth: mass 5.9722e24 kg; mean radius 6371008.4 m.
- Moon: mass 7.342e22 kg; mean radius 1737400 m.
- Earth heliocentric values in the table are retained from the original fixture for test stability.
- Moon geocentric mean elements at J2000.0: a=384400000 m, e=0.0554, i=5.16 deg, Ω=125.08 deg, ω=318.15 deg, M=135.27 deg. These values match the JPL Planetary Satellite Mean Elements table (DE405/LE405, 2000-01-01.5 TDB). They are mean elements, not a date-specific osculating state; solar perturbations and the 18.6-year nodal / 5.997-year apsidal cycles are not integrated.

## Satellite mean-element audit

Satellite parameters are sourced from the JPL Planetary Satellite Mean Elements tables, not from generic zero-angle defaults. The Rust/WASM physics layer transforms each element set from its declared reference plane into the common ecliptic inertial frame.

- Regular Jovian satellites use the JPL local Laplace plane; Ganymede and Callisto carry their separately published pole orientations. Himalia uses the JPL ecliptic solution.
- Main Saturnian satellites use the JPL local Laplace plane. Titan, Hyperion, Iapetus and Phoebe use their separately published Laplace-pole RA/Dec rather than Saturn's spin pole.
- Uranian satellites use JPL mean equatorial elements and are transformed from Uranus' equator.
- Neptune's inner satellites and Triton use JPL mean equatorial elements. Nereid uses the JPL NEP105 ecliptic solution at 2020-01-01.0 TDB; its mean anomaly is back-propagated to J2000 using the published 360.133039-day period.
- Phobos and Deimos use the revised JPL MAR099 mean elements and their individual Laplace-plane poles. The Moon uses the JPL DE405/LE405 ecliptic solution.

The catalogue was corrected for Phobos, Deimos, Ganymede, Callisto, Rhea, Titan, Hyperion, Iapetus, Miranda, Ariel, Umbriel, Titania, Oberon, Triton, Naiad, Thalassa, Despina, Galatea, Larissa, Proteus and Nereid. Himalia and Nereid use the ecliptic reference frame. Phobos, Deimos, Ganymede, Callisto, Titan, Hyperion, Iapetus and Phoebe carry explicit Laplace-plane pole metadata.

These mean elements describe average orbit shape/orientation; they do not reproduce short-period perturbations, resonance libration, apsidal/node precession or exact date-specific positions. Accurate time-tagged positions require JPL Horizons/SPICE ephemerides.

## Sources
- NASA/JPL Solar System Dynamics, *Approximate Positions of the Planets*: https://ssd.jpl.nasa.gov/planets/approx_pos.html — planetary secular elements, conventions and validity interval.
- NASA NSSDC, *Earth Fact Sheet*: https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html — Earth physical and orbital reference values.
- JPL Solar System Dynamics, *Planetary Satellite Mean Elements*: https://ssd.jpl.nasa.gov/sats/elem/sep.html — satellite mean elements, reference frames and epochs.
- JPL Solar System Dynamics, *Planetary Satellite Physical Parameters*: https://ssd.jpl.nasa.gov/sats/phys_par/sep.html — satellite GM, mean radius and density.

## Accuracy policy
The two-body hierarchy intentionally approximates the Solar System. The Moon's orbit is perturbed by the Sun; planetary mutual perturbations are not integrated. For high-fidelity validation and mission design, replace this fixture with timestamped JPL Horizons/DE440 states and a suitable numerical integrator.


## Zonal gravity coefficients

The single TypeScript body catalog now carries dimensionless (J_2), equatorial reference radius and J2000 spin-pole direction into the Rust/WASM physics DTO. The values below are taken from the MathWorks Aerospace Blockset planetary-data table, rather than inferred from visual shape or invented from the mean radius.

| Body | (J_2) |
|---|---:|
| Sun | (1.0\times10^{-7}) |
| Mercury | (50.3\times10^{-6}) |
| Venus | (4.458\times10^{-6}) |
| Earth | (1082.62617385222\times10^{-6}) |
| Moon | (202.7\times10^{-6}) |
| Mars | (1960.45\times10^{-6}) |
| Jupiter | (14736\times10^{-6}) |
| Saturn | (16298\times10^{-6}) |
| Uranus | (3343.43\times10^{-6}) |
| Neptune | (3411\times10^{-6}) |

Bodies without a sourced coefficient remain point masses ((J_2=0)); no value is extrapolated to small satellites. The Moon uses the catalogued J2000 pole orientation. The other bodies use their catalogued pole RA/Dec transformed into the catalog's ecliptic inertial basis.

Source: MathWorks, [Spacecraft Dynamics — planetary data and J2 definition](https://www.mathworks.com/help/aeroblks/spacecraftdynamics.html). The table also provides equatorial reference radii. The model implemented here is the second-degree zonal term only; higher harmonics, time-varying pole orientation and libration corrections are not included.
