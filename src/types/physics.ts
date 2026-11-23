/** Shared SI-unit contracts for the simulation's typed physics modules. */
export type Vector3 = Readonly<{ x: number; y: number; z: number }>;

export interface OrbitalState {
  readonly position: Vector3;
  readonly velocity: Vector3;
}

export interface CelestialBodyDefinition {
  readonly id: string;
  readonly name: string;
  readonly massKg: number;
  readonly meanRadiusM: number;
  readonly equatorialRadiusM?: number | null;
  readonly rotationPeriodSeconds?: number | null;
  readonly axialTiltRad?: number | null;
  readonly poleRightAscensionRad?: number | null;
  readonly poleDeclinationRad?: number | null;
  readonly rotationDirection?: 1 | -1;
  readonly primeMeridianRad?: number;
  readonly rotationEpochSeconds?: number;
  readonly tidalLock?: boolean;
  readonly solarDaySeconds?: number | null;
  readonly atmosphereComposition?: readonly string[];
  readonly hasRings?: boolean;
  readonly mu: number;
  readonly parentId: string | null;
}

export interface SimulationClock {
  readonly simulationTimeSeconds: number;
  readonly timeScale: number;
  readonly paused: boolean;
}

export interface KeplerPropagationInput {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly mu: number;
  readonly deltaTimeSeconds: number;
  readonly tolerance?: number;
  readonly maxIterations?: number;
}

export interface PropagatedState {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly iterations: number;
}

export interface ClassicalOrbitalElements {
  readonly semiMajorAxisM: number;
  readonly eccentricity: number;
  readonly inclination?: number;
  readonly longitudeAscendingNode?: number;
  readonly argumentOfPeriapsis?: number;
  readonly meanAnomaly?: number;
}

export interface VesselState {
  id: string;
  primaryBodyId: string;
  position: Vector3;
  velocity: Vector3;
  relativePosition: Vector3;
  relativeVelocity: Vector3;
  massKg: number;
  lastPrimarySwitch: { from: string; to: string; timeSeconds: number } | null;
}

export interface PhysicsWorldOptions {
  readonly fixedStepSeconds?: number;
  readonly maxSubSteps?: number;
  readonly soiEnterFactor?: number;
  readonly soiExitFactor?: number;
}

export type PlanetarySurfaceClass = 'rocky'|'oceanic'|'desert'|'icy'|'volcanic'|'dense-atmosphere'|'gas-giant'|'ice-giant'|'airless-moon'|'icy-moon'|'volcanic-moon';
/** Optional persisted world-generation metadata consumed by the procedural renderer. */
export interface PlanetarySurfaceParameters {
  readonly class?: PlanetarySurfaceClass;
  readonly temperatureK?: number;
  readonly pressurePa?: number;
  readonly waterFraction?: number;
  readonly iceFraction?: number;
  readonly ironFraction?: number;
  readonly silicateFraction?: number;
  readonly metalFraction?: number;
  readonly volatileFraction?: number;
  readonly hydrocarbonFraction?: number;
  readonly sulfurFraction?: number;
  readonly mineralComposition?: readonly string[];
  readonly tectonicActivity?: number;
  readonly volcanicActivity?: number;
  readonly impactAge?: number;
  readonly erosion?: number;
  readonly rotationFactor?: number;
}
