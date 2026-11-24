import { assertPositiveFinite } from './constants.ts';

/** Coplanar Hohmann transfer between circular orbits around one primary. */
export function hohmannTransfer({ primaryMu, initialRadiusM, targetRadiusM }) {
  assertPositiveFinite(primaryMu, 'primaryMu');
  assertPositiveFinite(initialRadiusM, 'initialRadiusM');
  assertPositiveFinite(targetRadiusM, 'targetRadiusM');
  if (initialRadiusM === targetRadiusM) return Object.freeze({ departureDeltaVMS: 0, arrivalDeltaVMS: 0, totalDeltaVMS: 0, transferTimeSeconds: 0, transferSemiMajorAxisM: initialRadiusM });
  const aTransfer = (initialRadiusM + targetRadiusM) / 2;
  const vInitial = Math.sqrt(primaryMu / initialRadiusM);
  const vTarget = Math.sqrt(primaryMu / targetRadiusM);
  const vTransferAtInitial = Math.sqrt(primaryMu * (2 / initialRadiusM - 1 / aTransfer));
  const vTransferAtTarget = Math.sqrt(primaryMu * (2 / targetRadiusM - 1 / aTransfer));
  const departureDeltaVMS = Math.abs(vTransferAtInitial - vInitial);
  const arrivalDeltaVMS = Math.abs(vTarget - vTransferAtTarget);
  return Object.freeze({
    departureDeltaVMS,
    arrivalDeltaVMS,
    totalDeltaVMS: departureDeltaVMS + arrivalDeltaVMS,
    transferTimeSeconds: Math.PI * Math.sqrt(aTransfer ** 3 / primaryMu),
    transferSemiMajorAxisM: aTransfer
  });
}

export function planeChangeDeltaV(speedMS, angleRadians) {
  assertPositiveFinite(speedMS, 'speedMS');
  if (!Number.isFinite(angleRadians) || angleRadians < 0 || angleRadians > Math.PI) throw new RangeError('angleRadians must be in [0, pi].');
  return 2 * speedMS * Math.sin(angleRadians / 2);
}
