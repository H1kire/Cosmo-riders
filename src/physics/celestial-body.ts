import { gravitationalParameter, assertPositiveFinite } from './constants.ts';
import { isFiniteVector, vector3 } from './vector3.ts';
import type { Vector3, ClassicalOrbitalElements, PlanetarySurfaceParameters } from '../types/physics.ts';

export interface CelestialBodyOptions {
  readonly id: string;
  readonly name: string;
  readonly massKg: number;
  readonly meanRadiusM: number;
  readonly position?: Vector3;
  readonly velocity?: Vector3;
  readonly parentId?: string | null;
  readonly semiMajorAxisM?: number | null;
  readonly orbitalElements?: ClassicalOrbitalElements | null;
  readonly surfaceSeed?: number;
  readonly surface?: Readonly<PlanetarySurfaceParameters>;
  readonly rotationPeriodSeconds?: number | null;
  readonly axialTiltRad?: number | null;
  readonly poleRightAscensionRad?: number | null;
  readonly poleDeclinationRad?: number | null;
  readonly rotationDirection?: 1 | -1;
  readonly primeMeridianRad?: number;
  readonly rotationEpochSeconds?: number;
  readonly tidalLock?: boolean;
  readonly equatorialRadiusM?: number | null;
  readonly solarDaySeconds?: number | null;
  readonly atmosphereComposition?: readonly string[];
  readonly hasRings?: boolean;
}

export class CelestialBody {
  readonly id: string;
  readonly name: string;
  readonly massKg: number;
  readonly meanRadiusM: number;
  readonly mu: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly parentId: string | null;
  readonly semiMajorAxisM: number | null;
  readonly orbitalElements: ClassicalOrbitalElements | null;
  readonly surfaceSeed: number | null;
  readonly surface: Readonly<PlanetarySurfaceParameters> | null;
  readonly rotationPeriodSeconds: number | null;
  readonly axialTiltRad: number | null;
  readonly poleRightAscensionRad: number | null;
  readonly poleDeclinationRad: number | null;
  readonly rotationDirection: 1 | -1;
  readonly primeMeridianRad: number;
  readonly rotationEpochSeconds: number;
  readonly tidalLock: boolean;
  readonly equatorialRadiusM: number | null;
  readonly solarDaySeconds: number | null;
  readonly atmosphereComposition: readonly string[];
  readonly hasRings: boolean;

  constructor({
    id,
    name,
    massKg,
    meanRadiusM,
    position = vector3(),
    velocity = vector3(),
    parentId = null,
    semiMajorAxisM = null,
    orbitalElements = null,
    surfaceSeed = null,
    surface = null,
    rotationPeriodSeconds = null,
    axialTiltRad = null,
    poleRightAscensionRad = null,
    poleDeclinationRad = null,
    rotationDirection = 1,
    primeMeridianRad = 0,
    rotationEpochSeconds = 0,
    tidalLock = false,
    equatorialRadiusM = null,
    solarDaySeconds = null,
    atmosphereComposition = [],
    hasRings = false,
  }: CelestialBodyOptions) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Body id must be non-empty.');
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Body name must be non-empty.');
    assertPositiveFinite(massKg, 'massKg');
    assertPositiveFinite(meanRadiusM, 'meanRadiusM');
    if (!isFiniteVector(position) || !isFiniteVector(velocity)) {
      throw new TypeError('position and velocity must be finite 3D vectors.');
    }
    if (semiMajorAxisM !== null) assertPositiveFinite(semiMajorAxisM, 'semiMajorAxisM');
    if (rotationPeriodSeconds !== null) assertPositiveFinite(rotationPeriodSeconds, 'rotationPeriodSeconds');
    if (equatorialRadiusM !== null) assertPositiveFinite(equatorialRadiusM, 'equatorialRadiusM');
    if (solarDaySeconds !== null) assertPositiveFinite(solarDaySeconds, 'solarDaySeconds');
    if (axialTiltRad !== null && !Number.isFinite(axialTiltRad)) throw new RangeError('axialTiltRad must be finite.');
    if (poleRightAscensionRad !== null && !Number.isFinite(poleRightAscensionRad)) throw new RangeError('poleRightAscensionRad must be finite.');
    if (poleDeclinationRad !== null && (!Number.isFinite(poleDeclinationRad)||Math.abs(poleDeclinationRad)>Math.PI/2)) throw new RangeError('poleDeclinationRad must be within +/- pi/2.');
    if (rotationDirection !== 1 && rotationDirection !== -1) throw new RangeError('rotationDirection must be 1 or -1.');
    if (!Number.isFinite(primeMeridianRad) || !Number.isFinite(rotationEpochSeconds)) throw new RangeError('Rotation phase and epoch must be finite.');
    if (!Array.isArray(atmosphereComposition) || atmosphereComposition.some(value => typeof value !== 'string')) throw new TypeError('atmosphereComposition must be a string array.');
    if (surfaceSeed !== null && !Number.isSafeInteger(surfaceSeed)) throw new RangeError('surfaceSeed must be a safe integer.');
    if (surface !== null) {
      for (const [key,value] of Object.entries(surface)) {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Surface parameter '+key+' must be finite.');
        if (typeof value === 'number' && key.endsWith('Fraction') && (value<0||value>1)) throw new RangeError('Surface fraction '+key+' must be in [0, 1].');
        if (typeof value === 'number' && ['tectonicActivity','volcanicActivity','impactAge','erosion','rotationFactor'].includes(key) && (value<0||value>1)) throw new RangeError('Surface parameter '+key+' must be in [0, 1].');
      }
      if (surface.temperatureK!==undefined && surface.temperatureK<=0) throw new RangeError('Surface temperature must be positive.');
      if (surface.pressurePa!==undefined && surface.pressurePa<0) throw new RangeError('Surface pressure cannot be negative.');
    }
    if (orbitalElements !== null) {
      if (!parentId) throw new Error('An orbiting body must have a parentId.');
      if (!Number.isFinite(orbitalElements.semiMajorAxisM) || orbitalElements.semiMajorAxisM <= 0) {
        throw new RangeError('orbitalElements.semiMajorAxisM must be positive.');
      }
      if (!Number.isFinite(orbitalElements.eccentricity) || orbitalElements.eccentricity < 0 || orbitalElements.eccentricity >= 1) {
        throw new RangeError('orbitalElements.eccentricity must be in [0, 1).');
      }
    }
    this.id = id;
    this.name = name;
    this.massKg = massKg;
    this.meanRadiusM = meanRadiusM;
    this.mu = gravitationalParameter(massKg);
    this.position = position;
    this.velocity = velocity;
    this.parentId = parentId;
    this.semiMajorAxisM = semiMajorAxisM ?? orbitalElements?.semiMajorAxisM ?? null;
    this.orbitalElements = orbitalElements ? Object.freeze({ ...orbitalElements }) : null;
    this.surfaceSeed = surfaceSeed;
    this.surface = surface ? Object.freeze({ ...surface }) : null;
    this.rotationPeriodSeconds = rotationPeriodSeconds;
    this.axialTiltRad = axialTiltRad;
    this.poleRightAscensionRad = poleRightAscensionRad;
    this.poleDeclinationRad = poleDeclinationRad;
    this.rotationDirection = rotationDirection;
    this.primeMeridianRad = primeMeridianRad;
    this.rotationEpochSeconds = rotationEpochSeconds;
    this.tidalLock = Boolean(tidalLock);
    this.equatorialRadiusM = equatorialRadiusM;
    this.solarDaySeconds = solarDaySeconds;
    this.atmosphereComposition = Object.freeze([...atmosphereComposition]);
    this.hasRings = Boolean(hasRings);
    Object.freeze(this);
  }
  /** Сидерический угол вычисляется непосредственно из единого времени симуляции. */
  rotationAngleAt(simulationTimeSeconds: number): number | null {
    if (this.rotationPeriodSeconds === null || this.tidalLock) return null;
    if (!Number.isFinite(simulationTimeSeconds)) throw new TypeError('simulationTimeSeconds must be finite.');
    const cycles = (simulationTimeSeconds - this.rotationEpochSeconds) / this.rotationPeriodSeconds;
    return this.primeMeridianRad + this.rotationDirection * 2 * Math.PI * cycles;
  }
}
