# Solar System reference data

## Epoch and model
The built-in Earth-Moon-Sun example is initialized at the J2000.0 epoch (2000-01-01 12:00 TT/TDB convention). It is a reproducible approximate Keplerian reference, not a substitute for JPL DE ephemerides or spacecraft navigation data.

## Sun → Earth → Moon
- Sun: mass 1.98847e30 kg; mean radius 695700000 m.
- Earth: mass 5.9722e24 kg; mean radius 6371008.4 m.
- Moon: mass 7.342e22 kg; mean radius 1737400 m.
- Earth heliocentric mean elements: a=1.00000011 AU, e=0.01671022, i=0.00005 deg, Ω=-11.26064 deg, longitude of perihelion=102.94719 deg, mean longitude=100.46435 deg.
- Moon geocentric rounded elements: a=384400000 m, e=0.0549, i=5.145 deg, Ω=125.08 deg, ω=318.15 deg, M=115.365 deg. These rounded values are for simulation and test fixtures; lunar perturbations and rapid element variation are not modeled.

## Sources
- NASA/JPL Solar System Dynamics, *Approximate Positions of the Planets*: https://ssd.jpl.nasa.gov/planets/approx_pos.html. The JPL page describes its fitted Keplerian elements, validity interval, element definitions and limitations.
- NASA NSSDC, *Earth Fact Sheet*: https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html. Earth mass/radius/orbital characteristics and J2000 mean elements.
- JPL Solar System Dynamics, *SB Satellites API*: https://ssd-api.jpl.nasa.gov/doc/sb_sat.html. Defines satellite orbital element fields and their frames/epochs.
- Earth-Moon orbital parameter values are rounded educational mean values; the model must not claim precision ephemeris agreement.

## Accuracy policy
The two-body hierarchy intentionally approximates the Solar System. The Moon's orbit is perturbed by the Sun; Earth's heliocentric state is not barycentric precision data. For high-fidelity validation and mission design, replace this fixture with timestamped JPL Horizons/DE440 states and a suitable numerical integrator.
