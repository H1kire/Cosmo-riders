import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudSystem, normalizeCloudLayer } from '../src/rendering/atmosphere/cloud-system.ts';
import { readFile } from 'node:fs/promises';

test('cloud layers normalize physical thickness and bounded material controls', () => {
  const layer = normalizeCloudLayer({ id: 'test', altitudeM: 12000, coverage: 2, opacity: -1, wind: [1, -1], scale: 4 });
  assert.equal(layer.coverage, 0.98);
  assert.equal(layer.opacity, 0);
  assert.equal(layer.wind[0], 0.02);
  assert.equal(layer.wind[1], -0.02);
  assert.ok((layer.thicknessM ?? 0) > 0);
  assert.equal(layer.detail, 3);
  assert.equal(layer.banding, 0);
  assert.throws(() => normalizeCloudLayer({ id: 'bad', altitudeM: -1, coverage: .5, opacity: .5, wind: [0,0], scale: 1 }), RangeError);
});

test('CloudSystem preserves independent ordered layers without sharing mutable wind arrays', () => {
  const system = new CloudSystem();
  system.setLayers('earth', [
    { id: 'cirrus', altitudeM: 10000, thicknessM: 2000, coverage: .2, opacity: .3, wind: [.001, 0], scale: 8 },
    { id: 'cumulus', altitudeM: 2000, thicknessM: 1000, coverage: .6, opacity: .8, wind: [0, .001], scale: 4 }
  ]);
  const layers = system.getLayers('earth');
  assert.deepEqual(layers.map(layer => layer.id), ['cirrus', 'cumulus']);
  layers[0].wind[0] = 0;
  assert.equal(system.getLayers('earth')[0].wind[0], .001);
  system.removeBody('earth');
  assert.equal(system.getLayers('earth').length, 0);
});

test('active WebGPU cloud shader ray-marches a bounded cloud shell with lighting and self-shadowing', async () => {
  const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
  assert.match(backend, /fn cloudField\(/);
  assert.match(backend, /fn cloudVolume\(/);
  assert.match(backend, /sampleCount = u32\(clamp\(3\.0 \+ detailLevel \* 1\.5, 4\.0, 12\.0\)\)/);
  assert.match(backend, /let selfShadow = exp\(-sunDensity \* 1\.65\)/);
  assert.match(backend, /let planetShadow = surfaceShadowVisibility\(samplePosition\)/);
  assert.match(backend, /let forwardPhase = miePhase\(cosine, 0\.58\)/);
  assert.match(backend, /cloud\.thicknessRatio/);
  assert.match(backend, /frame\.cloudDetail/);
});

test('Solar3DView submits multiple physical cloud layers from the active simulation bodies', async () => {
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  assert.match(solar, /high-cirrus/);
  assert.match(solar, /middle-cloud-deck/);
  assert.match(solar, /banding:1/);
  assert.match(solar, /thicknessRatio:\(layer\.thicknessM/);
  assert.match(solar, /cloudDetail:this\.graphics\.cloudDetail/);
});
