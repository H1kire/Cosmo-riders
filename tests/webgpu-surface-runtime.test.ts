import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGPUSurfaceRuntime } from '../src/rendering/webgpu/webgpu-surface-runtime.ts';
import { baseGeoTiles, childrenOf } from '../src/rendering/geodesic/icosphere.ts';
import type { SurfaceProfile, SurfaceTileData, SurfaceTileRequest } from '../src/rendering/geodesic/surface-tile.ts';

function fakeDevice() {
  const writes: any[] = [];
  return {
    writes,
    limits: { maxTextureDimension2D: 4096, maxTextureArrayLayers: 64 },
    createTexture(descriptor: any) {
      return { descriptor, createView: () => ({}), destroy() {} };
    },
    queue: { writeTexture(...args: any[]) { writes.push(args); } }
  };
}
const profile: SurfaceProfile = {
  bodyId: 'test-planet', seed: 1234, kind: 'rocky', massKg: 5.9e24, meanRadiusM: 6.3e6,
  gravityMS2: 9.8, temperatureK: 280, pressurePa: 100000, waterFraction: 0.2, iceFraction: 0.05,
  ironFraction: 0.3, silicateFraction: 0.6, volatileFraction: 0.03, sulfurFraction: 0.01,
  tectonicActivity: 0.4, volcanicActivity: 0.2, erosion: 0.3, age: 0.5,
  rotationPeriodSeconds: 86400, algorithmVersion: 1
};
function makeTile(request: SurfaceTileRequest): SurfaceTileData {
  const width = request.resolution + request.gutter! * 2, count = width * width;
  return {
    key: JSON.stringify({ planetId: request.planetId, requestSeed: request.seed, profile: {
      bodyId: profile.bodyId, seed: profile.seed, kind: profile.kind, massKg: profile.massKg,
      meanRadiusM: profile.meanRadiusM, gravityMS2: profile.gravityMS2, temperatureK: profile.temperatureK,
      pressurePa: profile.pressurePa, waterFraction: profile.waterFraction, iceFraction: profile.iceFraction,
      ironFraction: profile.ironFraction, silicateFraction: profile.silicateFraction, volatileFraction: profile.volatileFraction,
      sulfurFraction: profile.sulfurFraction, tectonicActivity: profile.tectonicActivity, volcanicActivity: profile.volcanicActivity,
      erosion: profile.erosion, age: profile.age, rotationPeriodSeconds: profile.rotationPeriodSeconds, algorithmVersion: profile.algorithmVersion
    }, tile: { face: request.tile.face, path: request.tile.path, level: request.tile.level },
    resolution: request.resolution, gutter: request.gutter ?? 2 }),
    resolution: request.resolution, gutter: request.gutter!,
    albedo: new Uint8Array(count * 4), normal: new Uint8Array(count * 3),
    height: new Float32Array(count).fill(125), roughness: new Uint8Array(count),
    materialId: new Uint8Array(count), generationMs: 0
  };
}
class FakeManager {
  requests: SurfaceTileRequest[] = [];
  disposed = false;
  markVisible(_key: string, _visible: boolean) {}
  markUploadPending(_key: string) {}
  markGpuReady(_key: string) {}
  dispose() { this.disposed = true; }
  async request(request: SurfaceTileRequest): Promise<SurfaceTileData> {
    this.requests.push(request);
    return makeTile(request);
  }
}

test('WebGPU runtime initializes pages incrementally and uploads real geodesic tile requests', async () => {
  const device = fakeDevice(), manager = new FakeManager();
  const runtime = new WebGPUSurfaceRuntime(device, 'test-planet', profile, { resolution: 8, gutter: 0, maxPages: 4 }, manager as any);
  for (let i = 0; i < 5; i++) runtime.initializeStep();
  assert.equal(runtime.ready, true);
  runtime.setVisibleTiles([baseGeoTiles()[0]]);
  await runtime.uploadVisibleTiles();
  assert.equal(manager.requests.length, 1);
  assert.equal(manager.requests[0].tile.face, 0);
  assert.equal(device.writes.length, 5);
  assert.equal(runtime.getPageLayer(baseGeoTiles()[0].id.key), 0);
  assert.equal(runtime.residentPages, 1);
  runtime.dispose();
  assert.equal(manager.disposed, true);
});

test('WebGPU runtime unpins pages when geodesic visibility changes', async () => {
  const device = fakeDevice(), manager = new FakeManager();
  const runtime = new WebGPUSurfaceRuntime(device, 'test-planet', profile, { resolution: 8, gutter: 0, maxPages: 2 }, manager as any);
  for (let i = 0; i < 5; i++) runtime.initializeStep();
  const root = baseGeoTiles()[0], child = childrenOf(root)[0];
  runtime.setVisibleTiles([root]);
  await runtime.uploadVisibleTiles();
  assert.equal(runtime.pages.isPinned(root.id.key), true);
  runtime.setVisibleTiles([child]);
  assert.equal(runtime.pages.isPinned(root.id.key), false);
  assert.equal(runtime.visibleTileCount, 1);
  runtime.dispose();
});

test('WebGPU runtime rejects duplicate visible geodesic tiles', () => {
  const runtime = new WebGPUSurfaceRuntime(fakeDevice(), 'test-planet', profile, { resolution: 8, gutter: 0 }, new FakeManager() as any);
  assert.throws(() => runtime.setVisibleTiles([baseGeoTiles()[0], baseGeoTiles()[0]]), /duplicate/);
  runtime.dispose();
});
