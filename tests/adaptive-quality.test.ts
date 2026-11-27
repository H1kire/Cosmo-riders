import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../src/rendering/quality/adaptive-quality.ts';
import { createGraphicsSettings } from '../src/rendering/quality/quality-settings.ts';

test('adaptive quality steps down after sustained slow frames and recovers after sustained headroom',()=>{
 const adaptive=new AdaptiveQuality('ultra',16.67);
 let level:'low'|'medium'|'high'|'ultra'='ultra';
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(30);
 assert.equal(level,'high');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(30);
 assert.equal(level,'medium');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(8);
 assert.equal(level,'high');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(8);
 assert.equal(level,'ultra');
});

test('all graphics presets enable optional adaptive quality by default',()=>{
 for(const preset of ['low','medium','high','ultra'] as const)assert.equal(createGraphicsSettings(preset).adaptiveQuality,true);
});

test('adaptive quality is wired into the active WebGPU LOD selector without cache recreation',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [presentation,backend,system]=await Promise.all([
  readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts',import.meta.url),'utf8')
 ]);
 assert.ok(presentation.includes('this.adaptiveQuality.addFrameTime(intervalMs)'));
 assert.ok(presentation.includes('geodesicTargetErrorPx:'));
 assert.ok(backend.includes('frame.geodesicTargetErrorPx'));
 assert.ok(system.includes('topology.lastSelectionErrorPx !== targetErrorPx'));
 assert.ok(system.includes('targetErrorPx: Math.max(0.5, Math.min(8, targetErrorPx))'));
});
