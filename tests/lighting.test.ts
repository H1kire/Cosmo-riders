import test from 'node:test';
import assert from 'node:assert/strict';
import { planetaryDisplayGain, solarIrradianceForDisplay } from '../src/rendering/lighting/lighting-system.ts';

test('solar display irradiance preserves inverse-square falloff with bounded distant-body compensation',()=>{
 assert.equal(solarIrradianceForDisplay(1),1);
 assert.ok(solarIrradianceForDisplay(0.387)>1,'inner planets receive greater solar irradiance');
 assert.ok(solarIrradianceForDisplay(5.2)<1,'Jupiter receives less solar irradiance than Earth');
 assert.ok(solarIrradianceForDisplay(30.1)<solarIrradianceForDisplay(5.2),'Neptune receives less irradiance than Jupiter');
 assert.ok(solarIrradianceForDisplay(30.1)>0,'distant planets retain non-zero illumination');
 assert.equal(solarIrradianceForDisplay(0),1);
 assert.ok(planetaryDisplayGain(30.1)<=64);
});

test('the active WebGPU surface, atmosphere, cloud and ring paths consume shared solar irradiance',async()=>{
 const {readFile}=await import('node:fs/promises');
 const [backend,atmosphere,geodesic]=await Promise.all([
  readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/atmosphere-scattering.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts',import.meta.url),'utf8')
 ]);
 assert.ok(backend.includes('solarIrradianceForDisplay(sunDistanceAU)'));
 assert.ok(backend.includes('solarIrradianceForDisplay(ringSunDistanceAU)'));
 assert.ok(backend.includes('max(body.lighting.x, 0.0)'));
 assert.ok(backend.includes('max(ring.color.w,0.0)'));
 assert.ok(atmosphere.includes('solarIrradiance = max(body.lighting.x, 0.0)'));
 assert.ok(geodesic.includes('Math.max(0, draw.lightIntensity ?? 1)'));
 assert.ok(geodesic.includes('* max(u.cameraPosition.w, 0.0)'));
});
