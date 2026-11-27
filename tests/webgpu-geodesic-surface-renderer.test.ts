import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGPUGeodesicSurfaceRenderer } from '../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts';

test('geodesic renderer creates indexed GPU buffers and submits page-backed draws', async () => {
  const buffers: any[] = [], calls: string[] = [], uniformWrites: Float32Array[] = [];
  let bindGroupLayout: any = null;
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: (value: any) => { bindGroupLayout = value; return value; },
    createPipelineLayout: (value: any) => value,
    createRenderPipelineAsync: async (value: any) => value,
    createSampler: (value: any) => value,
    createBuffer: (value: any) => { const buffer = { ...value, destroyed: false, destroy() { this.destroyed = true; } }; buffers.push(buffer); return buffer; },
    queue: { writeBuffer(_buffer: unknown, _offset: number, data: Float32Array) { uniformWrites.push(data.slice()); }, onSubmittedWorkDone: async () => undefined },
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
  const drawn = renderer.draw(pass, '0:root', { viewProjection: new Float32Array(16), model: new Float32Array(16), radiusM: 10, pageLayer: 0, lightIntensity: 0.25 });
  assert.equal(drawn, true);
  assert.equal(uniformWrites.at(-1)?.[43], 0.25, 'solar irradiance occupies the previously unused camera.w lane');
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


test('geodesic uniform updates reuse per-mesh storage and avoid allocations per draw', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('uniformData: Float32Array'));
  assert.ok(source.includes('uniformData: new Float32Array(84)'));
  assert.ok(source.includes('const data = mesh.uniformData'));
  assert.ok(!source.includes('Array.from(draw.model).slice'));
  assert.ok(source.includes('occluderCount==0u||u.sunPosition.w<=0.0'));
  assert.ok(source.includes('i<occluderCount'));
});

test('geodesic LOD caches immutable tile angular geometry between frames', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/geodesic/quadtree-selector.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('const tileGeometryCache = new Map<string, CachedTileGeometry>()'));
  assert.ok(source.includes('function tileGeometry(tile:GeoTile)'));
  assert.ok(source.includes('const sagitta=radius*geometry.sagittaFactor'));
});


test('geodesic LOD selection is reused for a stable camera and refreshed on movement or viewport changes', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('lastSelection: { readonly tiles: readonly GeoTile[]; readonly stats: GeodesicLodStats } | null'));
  assert.ok(source.includes('const selectionStale = selectionTime - topology.lastSelectionAt >= 120'));
  assert.ok(source.includes('const selectionChanged = moved || rotated || selectionStale'));
  assert.ok(source.includes('topology.lastSelectionWidth !== viewportWidthPx'));
  assert.ok(source.includes('topology.lastSelectionBudget !== transitionBudget'));
});


test('active geodesic LOD crossfade is not repeatedly retargeted by camera movement', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('if (signature !== topology.visibleSignature && !topology.transition)'));
  assert.ok(!source.includes('topology.transition.targetSignature !== signature'));
  assert.ok(source.includes('не замінюємо його цільовий набір новим'));
});


test('active WebGPU backend culls bodies, atmosphere/cloud shells and ring geometry by projected bounds',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
 assert.ok(source.includes('if (!isRenderSphereVisible(body.position, bodyRadius, frame)) continue'));
 assert.ok(source.includes('bodyRadius * shellScale, frame'));
 assert.ok(source.includes('isRenderSphereVisible(ringCenter, modelRadius(ringDraw.model), frame)'));
 assert.ok(source.includes('function modelRadius(model: ArrayLike<number>)'));
 assert.ok(source.includes('isSpherePotentiallyVisibleInFrustum('));
});


test('surface upload diagnostics count completed GPU page uploads rather than queued worker requests',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [backend,system]=await Promise.all([
  readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts',import.meta.url),'utf8')
 ]);
 assert.ok(backend.includes('getCacheDiagnostics().uploadCount'));
 assert.ok(backend.includes('metrics.surfaceUploadsPerFrame=Math.max(0,uploads-this.previousUploadCount)'));
 assert.ok(!backend.includes('geoStats.surfaceUploadsPerFrame'));
 assert.ok(!system.includes('frameSurfaceUploads'));
});
