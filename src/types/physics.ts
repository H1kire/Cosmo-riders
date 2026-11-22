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

export interface OrbitalState {
  readonly position: Vector3;
  readonly velocity: Vector3;
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
