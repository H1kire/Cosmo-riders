import { AU, DAY, G } from './constants.ts';
import { CelestialBody } from './celestial-body.ts';
import { PhysicsWorld } from './physics-world.ts';
import { orbitalPeriod } from './orbital-elements.ts';

const deg = (value: number) => value * Math.PI / 180;
// Zonal J2 coefficients from the cited gravity-field parameter tables (dimensionless).
const J2_COEFFICIENTS:Record<string,number> = {
  sun:1.0e-7,mercury:50.3e-6,venus:4.458e-6,earth:1082.62617385222e-6,
  moon:202.7e-6,mars:1960.45e-6,jupiter:14736e-6,saturn:16298e-6,
  uranus:3343.43e-6,neptune:3411e-6
};
const ENVIRONMENT:Record<string,{temperatureK:number;pressurePa:number}> = {
 mercury:{temperatureK:440,pressurePa:0},venus:{temperatureK:737,pressurePa:9.2e6},earth:{temperatureK:288,pressurePa:101325},
 mars:{temperatureK:210,pressurePa:610},jupiter:{temperatureK:165,pressurePa:1e5},saturn:{temperatureK:134,pressurePa:1e5},
 uranus:{temperatureK:76,pressurePa:1e5},neptune:{temperatureK:72,pressurePa:1e5},
 moon:{temperatureK:220,pressurePa:0},phobos:{temperatureK:233,pressurePa:0},deimos:{temperatureK:233,pressurePa:0},
 io:{temperatureK:130,pressurePa:0},europa:{temperatureK:102,pressurePa:0},titan:{temperatureK:94,pressurePa:146000},triton:{temperatureK:38,pressurePa:1.4}
};
const ATMOSPHERES:Record<string,readonly string[]> = {
 venus:['CO₂ ≈96.5%','N₂ ≈3.5%'],earth:['N₂ ≈78.08%','O₂ ≈20.95%','Ar ≈0.93%'],
 mars:['CO₂ ≈95.3%','N₂ ≈2.7%','Ar ≈1.6%'],jupiter:['H₂','He','следы CH₄, NH₃, H₂O'],
 saturn:['H₂','He','следы CH₄, NH₃'],uranus:['H₂','He','CH₄'],neptune:['H₂','He','CH₄'],
 titan:['N₂','CH₄'],triton:['N₂','CH₄']
};
const planet = (id: string, name: string, massKg: number, meanRadiusM: number, aAU: number, eccentricity: number, inclination: number, meanLongitude: number, longitudePerihelion: number, longitudeAscendingNode: number, rotationDays:number, axialTiltDeg:number, equatorialRadiusKm:number, solarDayHours:number, hasRings=false, poleRaDeg=0, poleDecDeg=90, primeMeridianDeg=0, rotationDirection:1|-1=1) => ({
  id, name, massKg, meanRadiusM, parentId: 'sun',j2:J2_COEFFICIENTS[id]??0,
  rotationPeriodSeconds:rotationDays*DAY,axialTiltRad:deg(axialTiltDeg),poleRightAscensionRad:deg(poleRaDeg),poleDeclinationRad:deg(poleDecDeg),primeMeridianRad:deg(primeMeridianDeg),rotationEpochSeconds:0,rotationDirection,
  equatorialRadiusM:equatorialRadiusKm*1000,solarDaySeconds:solarDayHours*3600,hasRings,
  surface:ENVIRONMENT[id],atmosphereComposition:ATMOSPHERES[id]??[],
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
  aKm: number, e = 0, inclinationDeg = 0, argumentDeg = 0, meanAnomalyDeg = 0, nodeDeg = 0, tidalLock = true
) => ({
  id, name, parentId,
  massKg: gmKm3S2 * 1e9 / G,j2:J2_COEFFICIENTS[id]??0,
  meanRadiusM: radiusKm * 1000,
  rotationPeriodSeconds:null,tidalLock,
  orbitalReferenceFrame:(parentId==='earth'?'ecliptic':'parent-equator') as 'ecliptic'|'parent-equator',
  surface:ENVIRONMENT[id],atmosphereComposition:ATMOSPHERES[id]??[],
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
  satellite('himalia','Himalia','jupiter',.15155,85,11439000,.160,28.4,321.1,78.3,64.2,false),

  satellite('mimas','Mimas','saturn',2.50349,198.2,186000,.020,1.6,160.4,275.3,66.2),
  satellite('enceladus','Enceladus','saturn',7.21037,252.1,238400,.005,0,119.5,57,0),
  satellite('tethys','Tethys','saturn',41.21353,531.1,295000,.001,1.1,335.3,0,273),
  satellite('dione','Dione','saturn',73.11607,561.4,377700,.002,0,116,212,0),
  satellite('rhea','Rhea','saturn',153.94175,763.5,527040,.001,0.35,0,0,0),
  satellite('titan','Titan','saturn',8978.13710,2574.76,1221860,.029,.33,0,0,0),
  satellite('hyperion','Hyperion','saturn',.37049,135,1481000,.104,.43,0,0,0,false),
  satellite('iapetus','Iapetus','saturn',120.51511,734.3,3560830,.028,15.47,0,0,0),
  satellite('phoebe','Phoebe','saturn',.55479,106.5,12929400,.164,175.2,240.3,308,192.7,false),
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
  satellite('nereid','Nereid','neptune',.206,170,5513400,.751,7.2,0,0,0,false)
] as const;

/** Approximate J2000.0 planetary elements. Planetary values follow the JPL
 * Approximate Positions of the Planets secular-element set (1800–2050 fit).
 * These are compact Keplerian starting elements, not a JPL Horizons ephemeris.
 */
export const SOLAR_SYSTEM_DATA = Object.freeze({
  epoch: 'J2000.0',
  sun: { id: 'sun', name: 'Sun', massKg: 1.98847e30, meanRadiusM: 695700000, equatorialRadiusM:695700000,j2:J2_COEFFICIENTS.sun, rotationPeriodSeconds:25.38*DAY, axialTiltRad:deg(7.25), poleRightAscensionRad:deg(286.13),poleDeclinationRad:deg(63.87),primeMeridianRad:deg(84.176),rotationEpochSeconds:0,rotationDirection:1 as const },
  mercury: planet('mercury', 'Mercury', 3.3011e23, 2439700, 0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,58.6462,.034,2440.53,4222.6,false,281.0097,61.4143,329.5469,1),
  venus: planet('venus', 'Venus', 4.8675e24, 6051800, 0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,243.018,177.36,6051.8,2802,false,272.76,67.16,160.20,-1),
  earth: {
    id: 'earth', name: 'Earth', massKg: 5.9722e24, meanRadiusM: 6371008.4, parentId: 'sun', rotationPeriodSeconds:.99726968*DAY,axialTiltRad:deg(23.4393),poleRightAscensionRad:deg(0),poleDeclinationRad:deg(90),primeMeridianRad:deg(190.147),rotationEpochSeconds:0,rotationDirection:1,equatorialRadiusM:6378136.6,j2:J2_COEFFICIENTS.earth,solarDaySeconds:86400,surface:ENVIRONMENT.earth,atmosphereComposition:ATMOSPHERES.earth,
    elements: { semiMajorAxisM: 1.00000011 * AU, eccentricity: 0.01671022, inclination: deg(0.00005), longitudeAscendingNode: deg(-11.26064), argumentOfPeriapsis: deg(102.94719 - (-11.26064)), meanAnomaly: deg(100.46435 - 102.94719) }
  },
  mars: planet('mars', 'Mars', 6.4171e23, 3389500, 1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,1.02595676,25.19,3396.19,24.7,false,317.68143,52.88650,176.630,1),
  jupiter: planet('jupiter', 'Jupiter', 1.8982e27, 69911000, 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,.41354,3.13,71492,9.9,true,268.056595,64.495303,284.95,1),
  saturn: planet('saturn', 'Saturn', 5.6834e26, 58232000, 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,.44401,26.73,60268,10.7,true,40.589,83.537,38.90,1),
  uranus: planet('uranus', 'Uranus', 8.6810e25, 25362000, 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,.71833,97.77,25559,17.2,true,257.311,-15.175,203.81,-1),
  neptune: planet('neptune', 'Neptune', 1.02413e26, 24622000, 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,.67125,28.32,24764,16.1,true,299.36,43.46,253.18,1),
  moon: satellites[0],
  ...Object.fromEntries(satellites.map(body => [body.id, body]))
});

/** Convert the single declarative J2000 catalogue into the Rust/WASM DTO contract.
 * No orbital state is calculated here; Rust owns ephemeris initialization.
 */
export function createSolarSystemBodyCatalog(): readonly Record<string, unknown>[] {
  return Object.values(SOLAR_SYSTEM_DATA)
    .filter((entry): entry is Exclude<typeof entry, string> => typeof entry === 'object' && entry !== null && 'massKg' in entry)
    .map(entry => {
      const body = entry as unknown as Record<string, unknown>;
      const elements = (body.elements ?? null) as Record<string, unknown> | null;
      return {
        id: body.id,
        name: body.name,
        massKg: body.massKg,
        meanRadiusM: body.meanRadiusM,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        parentId: body.parentId ?? null,
        semiMajorAxisM: elements?.semiMajorAxisM ?? null,
        orbitalElements: elements,
        surfaceSeed: body.surfaceSeed ?? null,
        surface: body.surface ?? null,
        rotationPeriodSeconds: body.rotationPeriodSeconds ?? null,
        axialTiltRad: body.axialTiltRad ?? null,
        poleRightAscensionRad: body.poleRightAscensionRad ?? null,
        poleDeclinationRad: body.poleDeclinationRad ?? null,
        rotationDirection: body.rotationDirection ?? 1,
        primeMeridianRad: body.primeMeridianRad ?? 0,
        rotationEpochSeconds: body.rotationEpochSeconds ?? 0,
        tidalLock: body.tidalLock ?? false,
        equatorialRadiusM: body.equatorialRadiusM ?? null,
        j2: body.j2 ?? 0,
        solarDaySeconds: body.solarDaySeconds ?? null,
        atmosphereComposition: body.atmosphereComposition ?? [],
        hasRings: body.hasRings ?? false,
        orbitalReferenceFrame: body.orbitalReferenceFrame ?? 'ecliptic'
      };
    });
}

export function createSolarSystemWorld(options = {}) {
  const world = new PhysicsWorld(options);
  world.addBody(new CelestialBody(SOLAR_SYSTEM_DATA.sun));
  for (const id of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const data = SOLAR_SYSTEM_DATA[id];
    world.addBody(new CelestialBody({ ...data, orbitalElements: data.elements }));
  }
  for (const data of satellites) {
    const parent=world.bodies.get(data.parentId)!;
    const rotationPeriodSeconds=data.tidalLock?orbitalPeriod(data.elements.semiMajorAxisM,parent.mu+data.massKg*G):data.rotationPeriodSeconds;
    world.addBody(new CelestialBody({ ...data, rotationPeriodSeconds, orbitalElements: data.elements }));
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
