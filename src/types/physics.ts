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
