import { AU, DAY, G } from './constants.js';
import { CelestialBody } from './celestial-body.js';
import { PhysicsWorld } from './physics-world.js';

/** Approximate J2000.0 reference data.
 * Earth heliocentric elements are from JPL SSD "Approximate Positions of the Planets"
 * (1800-2050 fit, Earth-Moon barycentric approximation); Moon elements are rounded
 * mean/osculating values for an educational two-body model, not a precision ephemeris.
 * Source notes: docs/SOLAR_SYSTEM_DATA.md
 */
const deg = value => value*Math.PI/180;
export const SOLAR_SYSTEM_DATA = Object.freeze({
  epoch: 'J2000.0',
  sun: { id:'sun', name:'Sun', massKg:1.98847e30, meanRadiusM:695700000 },
  earth: {
    id:'earth', name:'Earth', massKg:5.9722e24, meanRadiusM:6371008.4, parentId:'sun',
    elements:{ semiMajorAxisM:1.00000011*AU, eccentricity:0.01671022, inclination:deg(0.00005), longitudeAscendingNode:deg(-11.26064), argumentOfPeriapsis:deg(102.94719-(-11.26064)), meanAnomaly:deg(100.46435-102.94719) }
  },
  moon: {
    id:'moon', name:'Moon', massKg:7.342e22, meanRadiusM:1737400, parentId:'earth',
    elements:{ semiMajorAxisM:384400000, eccentricity:0.0549, inclination:deg(5.145), longitudeAscendingNode:deg(125.08), argumentOfPeriapsis:deg(318.15), meanAnomaly:deg(115.365) }
  }
});
export function createSolarSystemWorld(options={}) {
  const world=new PhysicsWorld(options);
  world.addBody(new CelestialBody(SOLAR_SYSTEM_DATA.sun));
  world.addBody(new CelestialBody({...SOLAR_SYSTEM_DATA.earth,orbitalElements:SOLAR_SYSTEM_DATA.earth.elements}));
  world.addBody(new CelestialBody({...SOLAR_SYSTEM_DATA.moon,orbitalElements:SOLAR_SYSTEM_DATA.moon.elements}));
  world.initializeEphemerides();
  return world;
}
export const SOLAR_SYSTEM_REFERENCE = Object.freeze({
  earthSiderealYearSeconds:365.256363004*DAY,
  moonSiderealMonthSeconds:27.321661*DAY,
  earthMeanDistanceM:AU,
  moonMeanDistanceM:384400000,
  earthSurfaceGravityMS2:9.80665,
  sunMuM3S2:G*1.98847e30
});
