import { assertFiniteNumber } from './constants.ts';
import type { Vector3 } from '../types/physics.ts';

export function vector3(x = 0, y = 0, z = 0): Vector3 {
  assertFiniteNumber(x, 'x');
  assertFiniteNumber(y, 'y');
  assertFiniteNumber(z, 'z');
  return Object.freeze({ x, y, z });
}

export function fromArray(values: readonly number[]): Vector3 {
  if (!Array.isArray(values) || values.length !== 3) throw new TypeError('Expected a 3-element array.');
  return vector3(values[0], values[1], values[2]);
}

export function toArray(value: Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return vector3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return vector3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(value: Vector3, factor: number): Vector3 {
  assertFiniteNumber(factor, 'scale');
  return vector3(value.x * factor, value.y * factor, value.z * factor);
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function magnitudeSquared(value: Vector3): number {
  return dot(value, value);
}

export function magnitude(value: Vector3): number {
  return Math.sqrt(magnitudeSquared(value));
}

export function normalize(value: Vector3): Vector3 {
  const length = magnitude(value);
  if (length === 0) throw new RangeError('Cannot normalize a zero-length vector.');
  return scale(value, 1 / length);
}

export function distance(a: Vector3, b: Vector3): number {
  return magnitude(subtract(a, b));
}

export function isFiniteVector(value: unknown): value is Vector3 {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Vector3;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z);
}
