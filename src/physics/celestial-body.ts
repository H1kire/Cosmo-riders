import { gravitationalParameter, assertPositiveFinite } from './constants.ts';
import { isFiniteVector, vector3 } from './vector3.ts';
import type { Vector3, ClassicalOrbitalElements } from '../types/physics.ts';

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
  }: CelestialBodyOptions) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('Body id must be non-empty.');
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Body name must be non-empty.');
    assertPositiveFinite(massKg, 'massKg');
    assertPositiveFinite(meanRadiusM, 'meanRadiusM');
    if (!isFiniteVector(position) || !isFiniteVector(velocity)) {
      throw new TypeError('position and velocity must be finite 3D vectors.');
    }
    if (semiMajorAxisM !== null) assertPositiveFinite(semiMajorAxisM, 'semiMajorAxisM');
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
    Object.freeze(this);
  }
}
