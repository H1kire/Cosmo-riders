import test from 'node:test';
import assert from 'node:assert/strict';
import { createSphereGeometry } from '../src/rendering/webgpu/webgpu-backend.ts';
import { resolveMsaaSamples, resolveRenderScale, resolveUploadsPerFrame, createGraphicsSettings } from '../src/rendering/quality/quality-settings.ts';

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
  assert.match(solar, /canvas\.classList\.add\('solar-webgpu-canvas'\)/);
  assert.match(solar, /pointerEvents:'auto'/);
  assert.doesNotMatch(solar, /getContext\('webgl2'\)/);
  assert.doesNotMatch(solar, /this\.canvas\.style\.opacity='0'/);
  assert.doesNotMatch(solar, /GeodesicPlanetRenderer/);
  assert.doesNotMatch(solar, /g\.drawElements|g\.useProgram/);
  assert.match(solar, /webgpuBodies\.push\(\{id:body\.id,model/);
  assert.match(solar, /webgpuOrbits\.push\(\{id:body\.id,points:path/);
  assert.match(solar, /webgpuBackend\.render\(\{viewProjection:vp,bodies:webgpuBodies,orbits:this\.webgpuOrbits/);
  assert.match(backend, /requestAdapter/);
  assert.match(backend, /requestDevice/);
  assert.match(backend, /getContext\('webgpu'\)/);
  assert.match(backend, /createRenderPipelineAsync/);
  assert.match(backend, /fn noise3\(/);
  assert.match(backend, /fn fbm3\(/);
  assert.match(backend, /baseField \* 0\.7 \+ ridges \* 0\.3/);
  assert.doesNotMatch(backend, /, field \* 0\.7 \+ ridges \* 0\.3/);
  assert.match(backend, /const RING_SHADER/);
  assert.match(backend, /ringPipeline/);
  assert.match(solar, /this\.webgpuRings\.push/);
  assert.match(backend, /smoothstep\(0\.455, 0\.545, field\)/);
  assert.match(solar, /waterFraction:body\.surface\?\.waterFraction/);
  assert.match(backend, /depth24plus/);
  assert.match(backend, /const levels: Array<\[number, number\]> = \[\[10, 14\], \[22, 30\], \[44, 60\], \[128, 192\]\]/);
  assert.match(backend, /const usesGeodesicSurface = Boolean\(body\.surfaceProfile/);
  assert.match(backend, /if \(usesGeodesicSurface\) \{/);
  assert.match(backend, /Тверда планета не переходить на спрощену сферу/);
  assert.match(backend, /body\.lod/);
  assert.match(solar, /lod:level/);
  assert.match(backend, /device\.lost/);
  assert.match(backend, /pass\.draw\(resources\.count\)/);
});

test('graphics presets provide independent geodesic upload budgets and valid render scales', () => {
  for (const level of ['low', 'medium', 'high', 'ultra'] as const) {
    const settings = createGraphicsSettings(level);
    assert.ok(settings.renderScale >= 0.5 && settings.renderScale <= 1.25);
    assert.ok(settings.geodesic.uploadsPerFrame >= 1 && settings.geodesic.uploadsPerFrame <= 8);
    assert.ok(settings.msaaSamples === 1 || settings.msaaSamples === 4);
    assert.notEqual(settings.geodesic, createGraphicsSettings(level).geodesic);
  }
});

test('runtime graphics controls clamp render scale and per-frame upload work', () => {
  assert.equal(resolveRenderScale(0.72), 0.72);
  assert.equal(resolveRenderScale(0), 0.5);
  assert.equal(resolveRenderScale(4), 1.25);
  assert.equal(resolveRenderScale(Number.NaN), 1);
  assert.equal(resolveUploadsPerFrame(3.8), 3);
  assert.equal(resolveUploadsPerFrame(0), 1);
  assert.equal(resolveUploadsPerFrame(99), 8);
  assert.equal(resolveUploadsPerFrame(undefined), 1);
});

test('active WebGPU backend allocates scaled scene and depth targets while presenting at canvas size', async () => {
  const { readFile } = await import('node:fs/promises');
  const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  assert.match(solar, /renderScale:this\.graphics\.renderScale/);
  assert.match(backend, /this\.sceneWidth = Math\.max\(1, Math\.round\(width \* this\.renderScale\)\)/);
  assert.match(backend, /createPostTargets\(this\.sceneWidth, this\.sceneHeight\)/);
  assert.match(backend, /requestedScale !== this\.renderScale/);
  assert.match(backend, /settingsKey !== this\.geodesicSettingsKey/);
  assert.match(backend, /activeSceneSize/);
});

test('geodesic upload work is bounded by the selected uploads-per-frame profile', async () => {
  const { readFile } = await import('node:fs/promises');
  const system = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts', import.meta.url), 'utf8');
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  assert.match(system, /readonly uploadsPerFrame: number/);
  assert.match(system, /this\.settings\.uploadsPerFrame/);
  assert.match(solar, /geodesicSettings:this\.graphics\.geodesic/);
});

test('MSAA sample count resolves only to WebGPU-supported 1x or 4x modes', () => {
  assert.equal(resolveMsaaSamples(undefined), 1);
  assert.equal(resolveMsaaSamples(0), 1);
  assert.equal(resolveMsaaSamples(2), 1);
  assert.equal(resolveMsaaSamples(4), 4);
  assert.equal(resolveMsaaSamples(8), 4);
});

test('all scene and geodesic pipelines use the active MSAA sample count', async () => {
  const { readFile } = await import('node:fs/promises');
  const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
  const geodesic = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts', import.meta.url), 'utf8');
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  assert.equal((backend.match(/multisample: \{ count: this\.msaaSamples \}/g) ?? []).length, 4);
  assert.equal((geodesic.match(/multisample: \{ count: sampleCount \}/g) ?? []).length, 4);
  assert.match(backend, /resolveTarget = this\.sceneTexture\.createView\(\)/);
  assert.match(backend, /sampleCount: this\.msaaSamples/);
  assert.match(backend, /reconfigureMsaa\(requestedMsaa\)/);
  assert.match(solar, /msaaSamples:this\.graphics\.msaaSamples/);
});
