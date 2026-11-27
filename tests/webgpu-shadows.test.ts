import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { angularDiskOverlapFraction, rayPlaneIntersectionDistance, ringShadowVisibility } from '../src/rendering/lighting/shadow-math.ts';

test('finite solar disc overlap produces total, partial and zero eclipse coverage',()=>{
 assert.equal(angularDiskOverlapFraction(.01,.02,0),1);
 assert.equal(angularDiskOverlapFraction(.01,.005,0),.25);
 assert.equal(angularDiskOverlapFraction(.01,.02,.04),0);
 const partial=angularDiskOverlapFraction(.01,.012,.015);
 assert.ok(partial>0&&partial<1);
 assert.equal(angularDiskOverlapFraction(.01,.02,NaN),0);
});

test('ring plane ray intersection is forward-only and rejects parallel rays',()=>{
 assert.equal(rayPlaneIntersectionDistance([0,1,0],[0,-1,0],[0,0,0],[0,1,0]),1);
 assert.equal(rayPlaneIntersectionDistance([0,1,0],[1,0,0],[0,0,0],[0,1,0]),null);
 assert.equal(rayPlaneIntersectionDistance([0,1,0],[0,1,0],[0,0,0],[0,1,0]),null);
});

test('ring shadow attenuation is confined to the annulus',()=>{
 assert.equal(ringShadowVisibility(.5,1,2,.7),1);
 assert.equal(ringShadowVisibility(2,1,2,.7),1);
 const visibility=ringShadowVisibility(1.5,1,2,.7);
 assert.ok(visibility>=0&&visibility<=1&&visibility<.5);
});

test('active WebGPU sphere and geodesic pipelines calculate finite-disc shadows per fragment',async()=>{
 const backend=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
 const geo=await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts',import.meta.url),'utf8');
 assert.match(backend,/fn angularDiskOverlap\(/);
 assert.match(backend,/body\.ringParams/);
 assert.match(backend,/minBindingSize: 384/);
 assert.match(geo,/fn shadowVisibility\(/);
 assert.match(geo,/shadowOccluders: array<vec4<f32>, 8>/);
 assert.match(geo,/minBindingSize: 336/);
});

test('live solar scene forwards simulation occluders to rings and avoids whole-body eclipse dimming',async()=>{
 const solar=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 const backend=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
 assert.match(solar,/shadowOccluders:webgpuShadowOccluders/);
 assert.match(solar,/sunPosition:sunRenderPosition/);
 assert.match(solar,/webgpuDraw\.eclipseVisibility=1/);
 assert.doesNotMatch(solar,/webgpuEclipseVisibility/);
 assert.match(backend,/ringLightVisibility/);
 assert.match(backend,/body\.ringShadow\.innerRadiusAU/);
});
