import test from 'node:test';
import assert from 'node:assert/strict';
import { createSphereGeometry } from '../src/rendering/webgpu/webgpu-backend.ts';

test('WebGPU sphere source creates indexed unit-sphere geometry', () => {
  const geometry = createSphereGeometry(10, 14);
  assert.equal(geometry.positions.length, (10 + 1) * (14 + 1) * 3);
  assert.equal(geometry.normals.length, geometry.positions.length);
  assert.equal(geometry.indices.length, 10 * 14 * 6);
  assert.ok(geometry.indices.every(index => index < (10 + 1) * (14 + 1)));
  for (let offset = 0; offset < geometry.positions.length; offset += 3) {
    const length = Math.hypot(
      geometry.positions[offset],
      geometry.positions[offset + 1],
      geometry.positions[offset + 2]
    );
    assert.ok(Math.abs(length - 1) < 1e-6);
  }
});

test('WebGPU sphere topology supports the current highest CPU mesh size', () => {
  const geometry = createSphereGeometry(128, 192);
  assert.equal(geometry.indices.length, 128 * 192 * 6);
  assert.ok(geometry.indices.length > 0);
  assert.ok(geometry.indices.every(index => index <= 65535));
});
