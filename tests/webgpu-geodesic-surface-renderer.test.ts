import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGPUGeodesicSurfaceRenderer } from '../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts';

test('geodesic renderer creates indexed GPU buffers and submits page-backed draws', async () => {
  const buffers: any[] = [], calls: string[] = [];
  let bindGroupLayout: any = null;
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: (value: any) => { bindGroupLayout = value; return value; },
    createPipelineLayout: (value: any) => value,
    createRenderPipelineAsync: async (value: any) => value,
    createSampler: (value: any) => value,
    createBuffer: (value: any) => { const buffer = { ...value, destroyed: false, destroy() { this.destroyed = true; } }; buffers.push(buffer); return buffer; },
    queue: { writeBuffer() {}, onSubmittedWorkDone: async () => undefined },
    createBindGroup: (value: any) => value
  };
  const views = Array.from({ length: 5 }, () => ({}));
  const pages: any = { ready: true, albedoView: views[0], normalView: views[1], heightView: views[2], roughnessView: views[3], materialView: views[4] };
  const renderer = await WebGPUGeodesicSurfaceRenderer.create(device, pages);
  const entries = bindGroupLayout.entries as Array<{ binding: number; visibility: number }>;
  assert.equal(entries.find(entry => entry.binding === 0)?.visibility, 3, 'uniform is used by vertex and fragment stages');
  assert.equal(entries.find(entry => entry.binding === 3)?.visibility, 1, 'height texture is vertex-only');
  for (const binding of [1, 2, 4, 5, 6]) assert.equal(entries.find(entry => entry.binding === binding)?.visibility, 2, `binding ${binding} is fragment-only`);
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
  renderer.releaseMesh('0:root');
  assert.equal(buffers.every(buffer => !buffer.destroyed), true, 'released mesh buffers stay alive until submitted work completes');
  renderer.afterSubmit();
  await Promise.resolve();
  assert.equal(buffers.every(buffer => buffer.destroyed), true, 'released mesh buffers are destroyed after queue completion');
  renderer.dispose();
});


test('WebGPU LOD crossfade separates source color, blended child color and final child depth',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [renderer,system]=await Promise.all([
  readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts',import.meta.url),'utf8')
 ]);
 assert.ok(renderer.includes("readonly transitionRole?: 'source' | 'blend' | 'depth'"));
 assert.ok(renderer.includes('depthWriteEnabled: false, depthCompare: \'less-equal\''));
 assert.ok(renderer.includes("writeMask: 0"));
 assert.ok(renderer.includes('depthWriteEnabled: true, depthCompare: \'less-equal\''));
 assert.ok(renderer.includes("role === 'source' ? this.sourcePipeline"));
 assert.ok(renderer.includes("role === 'depth' ? this.depthPipeline"));
 assert.ok(system.includes("transitionRole: 'source'"));
 assert.ok(system.includes("transitionRole: 'blend'"));
 assert.ok(system.includes("transitionRole: 'depth'"));
 assert.ok(system.indexOf("transitionRole: 'blend'")<system.indexOf("transitionRole: 'depth'"));
});


test('geodesic WGSL uses an explicit scalar integer conversion for texture bounds', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('let pageSizeI = i32(pageSize);'));
  assert.ok(source.includes('vec2<i32>(pageSizeI)'));
  assert.ok(!source.includes('vec2<i32>(pageSize)'));
});

test('geodesic renderer initialization errors are retained and do not trigger a per-frame retry loop', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('private rendererInitializationError: string | null = null;'));
  assert.ok(source.includes('!this.rendererInitializationError'));
  assert.ok(source.includes('this.rendererInitializationError = error instanceof Error ? error.message : String(error);'));
  assert.ok(source.includes('rendererInitializationError: this.rendererInitializationError'));
});
