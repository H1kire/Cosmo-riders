import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGPUGeodesicSurfaceRenderer } from '../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts';

test('geodesic renderer creates indexed GPU buffers and submits page-backed draws', async () => {
  const buffers: any[] = [], calls: string[] = [];
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: (value: any) => value,
    createPipelineLayout: (value: any) => value,
    createRenderPipelineAsync: async (value: any) => value,
    createSampler: (value: any) => value,
    createBuffer: (value: any) => { const buffer = { ...value, destroy() {} }; buffers.push(buffer); return buffer; },
    queue: { writeBuffer() {} },
    createBindGroup: (value: any) => value
  };
  const views = Array.from({ length: 5 }, () => ({}));
  const pages: any = { ready: true, albedoView: views[0], normalView: views[1], heightView: views[2], roughnessView: views[3], materialView: views[4] };
  const renderer = await WebGPUGeodesicSurfaceRenderer.create(device, pages);
  renderer.uploadMesh({
    tileKey: '0:root', resolution: 2, radiusM: 10,
    directions: new Float32Array([1,0,0, 0,1,0, 0,0,1]),
    positionsM: new Float32Array(9), normals: new Float32Array(9),
    textureCoordinates: new Float32Array([0,0, 1,0, 0,1]),
    indices: new Uint32Array([0,1,2])
  });
  const pass = {
    setPipeline() { calls.push('pipeline'); }, setBindGroup() { calls.push('bind'); },
    setVertexBuffer() { calls.push('vertex'); }, setIndexBuffer() { calls.push('index'); },
    drawIndexed(count: number) { calls.push('draw:'+count); }
  };
  const drawn = renderer.draw(pass, '0:root', { viewProjection: new Float32Array(16), model: new Float32Array(16), radiusM: 10, pageLayer: 0 });
  assert.equal(drawn, true);
  assert.deepEqual(calls.slice(-2), ['index', 'draw:3']);
  assert.equal(buffers.length, 5);
  renderer.dispose();
});
