import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGPUSurfacePageCache } from '../src/rendering/webgpu/webgpu-surface-page-cache.ts';
import type { SurfaceTileData } from '../src/rendering/geodesic/surface-tile.ts';

function fakeDevice() {
  const textures: Array<{ descriptor: any; destroyed: boolean; createView: (descriptor: any) => any; destroy: () => void }> = [];
  const writes: any[] = [];
  return {
    textures, writes,
    limits: { maxTextureDimension2D: 4096, maxTextureArrayLayers: 64 },
    createTexture(descriptor: any) {
      const texture = { descriptor, destroyed: false, createView: (view: any) => ({ texture, view }), destroy() { this.destroyed = true; } };
      textures.push(texture);
      return texture;
    },
    queue: { writeTexture(...args: any[]) { writes.push(args); } }
  };
}

function tile(key: string): SurfaceTileData {
  return {
    key, resolution: 2, gutter: 0,
    albedo: new Uint8Array(16).fill(20),
    normal: new Uint8Array(12).fill(127),
    height: new Float32Array([1, 2, 3, 4]),
    roughness: new Uint8Array(4).fill(180),
    materialId: new Uint8Array(4).fill(2),
    generationMs: 0
  };
}

test('WebGPU page cache incrementally allocates five correctly formatted texture arrays', () => {
  const device = fakeDevice();
  const cache = new WebGPUSurfacePageCache(device, 2, 0, 1024 * 1024, 4);
  assert.equal(cache.capacity, 4);
  for (let index = 0; index < 5; index++) assert.equal(cache.initializeStep(), index === 4);
  assert.deepEqual(device.textures.map(item => item.descriptor.format), ['rgba8unorm', 'rgba8unorm', 'r32float', 'r8unorm', 'r8unorm']);
  assert.equal(cache.ready, true);
  assert.equal(cache.allocatedBytes, 2 * 2 * 4 * 14);
  cache.dispose();
  assert.ok(device.textures.every(item => item.destroyed));
});

test('WebGPU page upload preserves five channels and pads rows for copy alignment', () => {
  const device = fakeDevice();
  const cache = new WebGPUSurfacePageCache(device, 2, 0, 1024 * 1024, 2);
  for (let index = 0; index < 5; index++) cache.initializeStep();
  assert.equal(cache.upload(tile('earth:root')), 0);
  assert.equal(device.writes.length, 5);
  assert.ok(device.writes.every(args => args[2].bytesPerRow === 256));
  assert.equal(device.writes[0][1][0], 20);
  assert.equal(device.writes[1][1][3], 255);
  assert.equal(new Float32Array(device.writes[2][1].buffer, 0, 66)[65], 4);
  assert.equal(cache.getLayer('earth:root'), 0);
  assert.equal(cache.residentPages, 1);
});

test('WebGPU page LRU never evicts pinned visible pages', () => {
  const device = fakeDevice();
  const cache = new WebGPUSurfacePageCache(device, 2, 0, 1024 * 1024, 2);
  for (let index = 0; index < 5; index++) cache.initializeStep();
  cache.upload(tile('a')); cache.upload(tile('b'));
  assert.equal(cache.pin('a'), true);
  assert.equal(cache.upload(tile('c')), 1);
  assert.equal(cache.getLayer('a'), 0);
  assert.equal(cache.getLayer('b'), undefined);
  cache.unpin('a');
  assert.equal(cache.upload(tile('d')), 1);
  assert.equal(cache.getLayer('a'), 0);
  assert.equal(cache.getLayer('c'), undefined);
  assert.equal(cache.getLayer('d'), 1);
});

test('WebGPU page cache rejects mismatched channel dimensions', () => {
  const device = fakeDevice();
  const cache = new WebGPUSurfacePageCache(device, 2, 0, 1024 * 1024, 2);
  for (let index = 0; index < 5; index++) cache.initializeStep();
  assert.throws(() => cache.upload({ ...tile('bad'), normal: new Uint8Array(3) }), /channel lengths/);
});

test('WebGPU page cache invalidates an evicted page after a partial GPU upload failure', () => {
  const device = fakeDevice();
  const cache = new WebGPUSurfacePageCache(device, 2, 0, 1024 * 1024, 1);
  for (let index = 0; index < 5; index++) cache.initializeStep();
  cache.upload(tile('old-page'));

  const writeTexture = device.queue.writeTexture;
  let attempts = 0;
  device.queue.writeTexture = (...args: any[]) => {
    attempts++;
    if (attempts === 3) throw new Error('simulated texture upload failure');
    writeTexture(...args);
  };
  assert.throws(() => cache.upload(tile('failed-page')), /simulated texture upload failure/);
  assert.equal(cache.getLayer('old-page'), undefined);
  assert.equal(cache.getLayer('failed-page'), undefined);
  assert.equal(cache.residentPages, 0);

  device.queue.writeTexture = writeTexture;
  assert.equal(cache.upload(tile('replacement-page')), 0);
  assert.equal(cache.getLayer('replacement-page'), 0);
});
