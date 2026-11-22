import { STANDARD_GRAVITY, assertPositiveFinite } from './constants.ts';
import { add, magnitude, normalize, scale } from './vector3.ts';

/** Simple pressure-compensated chemical engine model. SI units throughout. */
export function engineThrustAtPressure({ vacuumThrustN, seaLevelThrustN = vacuumThrustN, ambientPressurePa = 0, referencePressurePa = 101325 }) {
  assertPositiveFinite(vacuumThrustN, 'vacuumThrustN');
  if (!Number.isFinite(seaLevelThrustN) || seaLevelThrustN < 0 || seaLevelThrustN > vacuumThrustN) throw new RangeError('seaLevelThrustN must be between zero and vacuum thrust.');
  if (!Number.isFinite(ambientPressurePa) || ambientPressurePa < 0) throw new RangeError('ambientPressurePa must be non-negative.');
  assertPositiveFinite(referencePressurePa, 'referencePressurePa');
  const ratio = Math.min(1, ambientPressurePa / referencePressurePa);
  return vacuumThrustN + (seaLevelThrustN - vacuumThrustN) * ratio;
}

export function engineMassFlowKgS(thrustN, ispSeconds) {
  assertPositiveFinite(thrustN, 'thrustN');
  assertPositiveFinite(ispSeconds, 'ispSeconds');
  return thrustN / (ispSeconds * STANDARD_GRAVITY);
}

export function calculateBurn({ initialMassKg, dryMassKg, deltaVMS, thrustN, ispSeconds }) {
  assertPositiveFinite(initialMassKg, 'initialMassKg');
  assertPositiveFinite(dryMassKg, 'dryMassKg');
  assertPositiveFinite(thrustN, 'thrustN');
  assertPositiveFinite(ispSeconds, 'ispSeconds');
  if (dryMassKg >= initialMassKg) throw new RangeError('Dry mass must be smaller than initial mass.');
  if (!Number.isFinite(deltaVMS) || deltaVMS < 0) throw new RangeError('deltaVMS must be non-negative.');
  const finalMassKg = initialMassKg / Math.exp(deltaVMS / (ispSeconds * STANDARD_GRAVITY));
  if (finalMassKg < dryMassKg) throw new RangeError('Requested burn exceeds available propellant.');
  const propellantUsedKg = initialMassKg - finalMassKg;
  const massFlowKgS = engineMassFlowKgS(thrustN, ispSeconds);
  return Object.freeze({ initialMassKg, finalMassKg, propellantUsedKg, burnDurationSeconds: propellantUsedKg / massFlowKgS, massFlowKgS, deltaVMS });
}

/** Applies an idealized impulsive burn to a PhysicsWorld vessel.
 * Burn duration and propellant are calculated with the rocket equation; gravity
 * during the finite burn is not integrated in this first propulsion model.
 */
export function executeIdealizedBurn(world, vesselId, { direction, deltaVMS, engine, ambientPressurePa = 0, dryMassKg }) {
  const vessel = world.vessels.get(vesselId);
  if (!vessel) throw new Error('Unknown vessel: ' + vesselId);
  if (!direction) throw new TypeError('Burn direction is required.');
  const unitDirection = normalize(direction);
  const thrustN = engineThrustAtPressure({ ...engine, ambientPressurePa });
  const burn = calculateBurn({ initialMassKg: vessel.massKg, dryMassKg, deltaVMS, thrustN, ispSeconds: engine.ispSeconds });
  vessel.relativeVelocity = add(vessel.relativeVelocity, scale(unitDirection, deltaVMS));
  const primaryState = world.getBodyState(vessel.primaryBodyId);
  vessel.velocity = add(primaryState.velocity, vessel.relativeVelocity);
  vessel.massKg = burn.finalMassKg;
  return Object.freeze({ ...burn, thrustN, thrustToWeightRatio: thrustN / (vessel.massKg * STANDARD_GRAVITY) });
}

export function thrustToWeightRatio(thrustN, massKg, localGravityMS2) {
  assertPositiveFinite(thrustN, 'thrustN');
  assertPositiveFinite(massKg, 'massKg');
  assertPositiveFinite(localGravityMS2, 'localGravityMS2');
  return thrustN / (massKg * localGravityMS2);
}
