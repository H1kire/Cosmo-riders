import { AU, DAY, G } from './constants.ts';
import { CelestialBody } from './celestial-body.ts';
import { PhysicsWorld } from './physics-world.ts';

const deg = (value: number) => value * Math.PI / 180;
const planet = (id: string, name: string, massKg: number, meanRadiusM: number, aAU: number, eccentricity: number, inclination: number, meanLongitude: number, longitudePerihelion: number, longitudeAscendingNode: number) => ({
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

/** JPL mean satellite elements, epoch J2000.0.
 * GM values are converted to mass; radii are mean radii. Orbits are
 * two-body mean-element approximations, not Horizons numerical ephemerides.
 */
const satellite = (
  id: string, name: string, parentId: string, gmKm3S2: number, radiusKm: number,
  aKm: number, e = 0, inclinationDeg = 0, argumentDeg = 0, meanAnomalyDeg = 0, nodeDeg = 0
) => ({
  id, name, parentId,
  massKg: gmKm3S2 * 1e9 / G,
  meanRadiusM: radiusKm * 1000,
  elements: {
    semiMajorAxisM: aKm * 1000,
    eccentricity: e,
    inclination: deg(inclinationDeg),
    longitudeAscendingNode: deg(nodeDeg),
    argumentOfPeriapsis: deg(argumentDeg),
    meanAnomaly: deg(meanAnomalyDeg)
  }
});

const satellites = [
  satellite('moon','Moon','earth',4902.800,1737.4,384400,.0554,5.16,318.15,135.27,125.08),
  satellite('phobos','Phobos','mars',.0007087,11.08,9375,.015,1.1,216.3,189.7,169.2),
  satellite('deimos','Deimos','mars',.0000962,6.2,23457,.0002,1.8,0,205,54.3),

  satellite('io','Io','jupiter',5959.91547,1821.49,421800,.004,0,49.1,330.9,0),
  satellite('europa','Europa','jupiter',3202.71210,1560.80,671100,.009,.5,45,345.4,184),
  satellite('ganymede','Ganymede','jupiter',9887.83275,2631.20,1070400,.001,.2,198.3,324.8,58.5),
  satellite('callisto','Callisto','jupiter',7179.28340,2410.30,1882700,.007,.3,43.8,87.4,309.1),
  satellite('amalthea','Amalthea','jupiter',.16456,83.5,181400,.003,.4,180.1,310.6,282.9),
  satellite('thebe','Thebe','jupiter',.03015,49.3,221900,.018,1.1,26.6,182.1,340.4),
  satellite('adrastea','Adrastea','jupiter',.00014,8.2,129000,0,0,0,214.5,0),
  satellite('metis','Metis','jupiter',.00250,21.5,128000,0,0,0,166,0),
  satellite('himalia','Himalia','jupiter',.15155,85,11439000,.160,28.4,321.1,78.3,64.2),

  satellite('mimas','Mimas','saturn',2.50349,198.2,186000,.020,1.6,160.4,275.3,66.2),
  satellite('enceladus','Enceladus','saturn',7.21037,252.1,238400,.005,0,119.5,57,0),
  satellite('tethys','Tethys','saturn',41.21353,531.1,295000,.001,1.1,335.3,0,273),
  satellite('dione','Dione','saturn',73.11607,561.4,377700,.002,0,116,212,0),
  satellite('rhea','Rhea','saturn',153.94175,763.5,527040,.001,0.35,0,0,0),
  satellite('titan','Titan','saturn',8978.13710,2574.76,1221860,.029,.33,0,0,0),
  satellite('hyperion','Hyperion','saturn',.37049,135,1481000,.104,.43,0,0,0),
  satellite('iapetus','Iapetus','saturn',120.51511,734.3,3560830,.028,15.47,0,0,0),
  satellite('phoebe','Phoebe','saturn',.55479,106.5,12929400,.164,175.2,240.3,308,192.7),
  satellite('janus','Janus','saturn',.12662,89.2,151500,.007,.2,11.1,111.7,159.9),
  satellite('epimetheus','Epimetheus','saturn',.03514,58.2,151400,.020,.3,96.3,197.2,189.8),
  satellite('helene','Helene','saturn',.00048,18,377600,.007,.2,194.3,295.5,260.8),
  satellite('atlas','Atlas','saturn',.00037,15.1,137700,.001,0,82.3,289.1,0),
  satellite('prometheus','Prometheus','saturn',.01071,43.1,139400,.002,0,341.9,135.4,0),
  satellite('pandora','Pandora','saturn',.00926,40.6,141700,.004,0,217.9,123.9,0),
  satellite('pan','Pan','saturn',.00028,14,133600,0,0,0,146.6,0),

  satellite('miranda','Miranda','uranus',4.3,235.8,129900,.0013,4.34,0,0,0),
  satellite('ariel','Ariel','uranus',83.5,578.9,190900,.0012,.04,0,0,0),
  satellite('umbriel','Umbriel','uranus',85.1,584.7,265969,.0039,.13,0,0,0),
  satellite('titania','Titania','uranus',226.9,788.9,436300,.0011,.08,0,0,0),
  satellite('oberon','Oberon','uranus',205.3,761.4,583400,.0014,.07,0,0,0),

  satellite('naiad','Naiad','neptune',.00853,29,48227,.0003,4.7,0,0,0),
  satellite('thalassa','Thalassa','neptune',.02359,40,50075,.0002,0.2,0,0,0),
  satellite('despina','Despina','neptune',.11673,74,52526,.0002,.1,0,0,0),
  satellite('galatea','Galatea','neptune',.18990,79,61953,.0002,.1,0,0,0),
  satellite('larissa','Larissa','neptune',.25484,96,73548,.0014,.2,0,0,0),
  satellite('proteus','Proteus','neptune',2.58342,208,117647,.0005,.5,0,0,0),
  satellite('triton','Triton','neptune',1428.49546,1352.60,354760,.000016,156.8,0,0,0),
  // Nereid's mass is not measured in the JPL parameter table; this low-impact estimate assumes 1.5 g/cm³.
  satellite('nereid','Nereid','neptune',.206,170,5513400,.751,7.2,0,0,0)
] as const;

/** Approximate J2000.0 planetary elements. Planetary values follow the JPL
 * Approximate Positions of the Planets secular-element set (1800–2050 fit).
 * These are compact Keplerian starting elements, not a JPL Horizons ephemeris.
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
  mars: planet('mars', 'Mars', 6.4171e23, 3389500, 1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891),
  jupiter: planet('jupiter', 'Jupiter', 1.8982e27, 69911000, 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909),
  saturn: planet('saturn', 'Saturn', 5.6834e26, 58232000, 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448),
  uranus: planet('uranus', 'Uranus', 8.6810e25, 25362000, 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503),
  neptune: planet('neptune', 'Neptune', 1.02413e26, 24622000, 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574),
  ...Object.fromEntries(satellites.map(body => [body.id, body]))
});

export function createSolarSystemWorld(options = {}) {
  const world = new PhysicsWorld(options);
  world.addBody(new CelestialBody(SOLAR_SYSTEM_DATA.sun));
  for (const id of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const data = SOLAR_SYSTEM_DATA[id];
    world.addBody(new CelestialBody({ ...data, orbitalElements: data.elements }));
  }
  for (const data of satellites) {
    world.addBody(new CelestialBody({ ...data, orbitalElements: data.elements }));
  }
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
