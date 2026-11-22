import { AU, DAY, G } from './constants.ts';
import { CelestialBody } from './celestial-body.ts';
import { PhysicsWorld } from './physics-world.ts';

const deg = value => value * Math.PI / 180;
const planet = (id, name, massKg, meanRadiusM, aAU, eccentricity, inclination, meanLongitude, longitudePerihelion, longitudeAscendingNode) => ({
  id, name, massKg, meanRadiusM, parentId: 'sun',
  elements: {
    semiMajorAxisM: aAU * AU,
    eccentricity,
    inclination: deg(inclination),
    longitudeAscendingNode: deg(longitudeAscendingNode),
    argumentOfPeriapsis: deg(longitudePerihelion - longitudeAscendingNode),
    meanAnomaly: deg(meanLongitude - longitudePerihelion)
  }
});

/** Approximate J2000.0 planetary elements. Planetary values follow the JPL
 * Approximate Positions of the Planets secular-element set (1800–2050 fit).
 * These are compact Keplerian starting elements, not a JPL Horizons ephemeris.
 * The Moon retains rounded educational geocentric elements.
 */
export const SOLAR_SYSTEM_DATA = Object.freeze({
  epoch: 'J2000.0',
  sun: { id: 'sun', name: 'Sun', massKg: 1.98847e30, meanRadiusM: 695700000 },
  mercury: planet('mercury', 'Mercury', 3.3011e23, 2439700, 0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593),
  venus: planet('venus', 'Venus', 4.8675e24, 6051800, 0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255),
  earth: {
    id: 'earth', name: 'Earth', massKg: 5.9722e24, meanRadiusM: 6371008.4, parentId: 'sun',
    elements: { semiMajorAxisM: 1.00000011 * AU, eccentricity: 0.01671022, inclination: deg(0.00005), longitudeAscendingNode: deg(-11.26064), argumentOfPeriapsis: deg(102.94719 - (-11.26064)), meanAnomaly: deg(100.46435 - 102.94719) }
  },
  moon: {
    id: 'moon', name: 'Moon', massKg: 7.342e22, meanRadiusM: 1737400, parentId: 'earth',
    elements: { semiMajorAxisM: 384400000, eccentricity: 0.0549, inclination: deg(5.145), longitudeAscendingNode: deg(125.08), argumentOfPeriapsis: deg(318.15), meanAnomaly: deg(115.365) }
  },
  mars: planet('mars', 'Mars', 6.4171e23, 3389500, 1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
  jupiter: planet('jupiter', 'Jupiter', 1.8982e27, 69911000, 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
  saturn: planet('saturn', 'Saturn', 5.6834e26, 58232000, 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
  uranus: planet('uranus', 'Uranus', 8.6810e25, 25362000, 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503),
  neptune: planet('neptune', 'Neptune', 1.02413e26, 24622000, 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574)
});

export function createSolarSystemWorld(options = {}) {
  const world = new PhysicsWorld(options);
  world.addBody(new CelestialBody(SOLAR_SYSTEM_DATA.sun));
  for (const id of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const data = SOLAR_SYSTEM_DATA[id];
    world.addBody(new CelestialBody({ ...data, orbitalElements: data.elements }));
  }
  const moon = SOLAR_SYSTEM_DATA.moon;
  world.addBody(new CelestialBody({ ...moon, orbitalElements: moon.elements }));
  world.initializeEphemerides();
  return world;
}

export const SOLAR_SYSTEM_REFERENCE = Object.freeze({
  earthSiderealYearSeconds: 365.256363004 * DAY,
  moonSiderealMonthSeconds: 27.321661 * DAY,
  earthMeanDistanceM: AU,
  moonMeanDistanceM: 384400000,
  earthSurfaceGravityMS2: 9.80665,
  sunMuM3S2: G * 1.98847e30
});
