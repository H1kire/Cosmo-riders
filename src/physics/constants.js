/** Physical constants. All engine values use SI units. */
export const G = 6.67430e-11; // m^3 kg^-1 s^-2, CODATA 2018
export const AU = 149_597_870_700; // m, exact
export const LIGHT_YEAR = 9.4607304725808e15; // m
export const STANDARD_GRAVITY = 9.80665; // m s^-2
export const DAY = 86_400; // s
export const JULIAN_YEAR = 31_557_600; // s
export const TWO_PI = 2 * Math.PI;
export function gravitationalParameter(massKg) { assertPositiveFinite(massKg, 'massKg'); return G * massKg; }
export function assertFiniteNumber(value, name) { if (!Number.isFinite(value)) throw new TypeError(name + ' must be a finite number.'); }
export function assertPositiveFinite(value, name) { assertFiniteNumber(value, name); if (value <= 0) throw new RangeError(name + ' must be greater than zero.'); }