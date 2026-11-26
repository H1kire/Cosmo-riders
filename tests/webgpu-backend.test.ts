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

test('Solar3DView submits real body transforms and orbit paths to the native WebGPU backend', async () => {
  const { readFile } = await import('node:fs/promises');
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
  assert.match(solar, /new WebGPUBackend\(canvas\)/);
  assert.match(solar, /this\.canvas\.style\.opacity='0'/);
  assert.match(solar, /pointerEvents:'none'/);
  assert.match(solar, /webgpuBodies\.push\(\{id:body\.id,model/);
  assert.match(solar, /webgpuOrbits\?\.push\(\{id:body\.id,points:path/);
  assert.match(solar, /webgpuBackend\.render\(\{viewProjection:vp,bodies:webgpuBodies,orbits:this\.webgpuOrbits/);
  assert.match(backend, /requestAdapter/);
  assert.match(backend, /requestDevice/);
  assert.match(backend, /getContext\('webgpu'\)/);
  assert.match(backend, /createRenderPipelineAsync/);
  assert.match(backend, /depth24plus/);
  assert.match(backend, /device\.lost/);
  assert.match(backend, /pass\.draw\(resources\.count\)/);
});
