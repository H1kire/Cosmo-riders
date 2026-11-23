import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEclipse } from '../src/rendering/lighting/eclipse-system.ts';
import { rayleighPhase, miePhase, exponentialDensity, transmittance } from '../src/rendering/atmosphere/scattering.ts';
import { createGraphicsSettings } from '../src/rendering/quality/quality-settings.ts';
import { AdaptiveQuality } from '../src/rendering/quality/adaptive-quality.ts';
import { RenderPipeline } from '../src/rendering/core/render-pipeline.ts';

test('analytic eclipse estimates full and zero occultation',()=>{
 const full=calculateEclipse([100,0,0],5,[50,0,0],5,[0,0,0]);
 assert.ok(full.visibility<1e-8);assert.ok(full.obscuredFraction>.999999);
 const clear=calculateEclipse([100,0,0],5,[50,20,0],5,[0,0,0]);
 assert.equal(clear.visibility,1);assert.equal(clear.obscuredFraction,0);
});
test('atmospheric scattering helpers remain finite and physically bounded',()=>{
 assert.ok(rayleighPhase(0)>0);assert.ok(miePhase(.5,.76)>0);
 assert.equal(exponentialDensity(0,8000),1);
 assert.ok(exponentialDensity(8000,8000)<1);
 const t=transmittance([0,1,2]);assert.deepEqual(t,[1,Math.exp(-1),Math.exp(-2)]);
});
test('graphics presets expose the expected quality tiers',()=>{
 assert.equal(createGraphicsSettings('low').bloom,false);
 assert.equal(createGraphicsSettings('ultra').shadowMapSize,2048);
 assert.equal(createGraphicsSettings('high').hdr,true);
});
test('adaptive quality steps down under sustained frame-time pressure',()=>{
 const q=new AdaptiveQuality('high',16.67);for(let i=0;i<45;i++)q.addFrameTime(30);
 assert.equal(q.level,'medium');
});
test('render pipeline orders passes and rejects duplicate names',()=>{
 const pipeline=new RenderPipeline(),order:string[]=[];
 const pass=(name:string,rank:number)=>({name,order:rank,enabled:true,render(){order.push(name);}});
 pipeline.add(pass('post',20));pipeline.add(pass('scene',0));pipeline.render({} as never);
 assert.deepEqual(order,['scene','post']);assert.throws(()=>pipeline.add(pass('scene',2)),/Duplicate/);
});

import { ShaderLibrary } from '../src/rendering/core/shader-library.ts';
import { createDefaultShaderLibrary } from '../src/rendering/shaders/index.ts';

test('shader library expands nested reusable chunks and keeps GLSL version first',()=>{
  const library=createDefaultShaderLibrary();
  const source=library.compose('#version 300 es\n#include <common>\n#include <atmosphere>',{USE_CLOUDS:true,QUALITY:2});
  assert.ok(source.includes('#version 300 es'));
  assert.ok(source.includes('#define USE_CLOUDS 1'));
  assert.ok(source.includes('#define QUALITY 2'));
  assert.ok(source.includes('float rayleighPhase'));
  assert.ok(source.includes('float saturate'));
});

test('shader library rejects missing and circular includes',()=>{
  const library=new ShaderLibrary();
  assert.throws(()=>library.compose('#include <missing>'),/Unknown shader chunk/);
  library.register('first','#include <second>');
  library.register('second','#include <first>');
  assert.throws(()=>library.compose('#include <first>'),/Circular shader include/);
});

test('graphics presets control real render scale and post-process quality',()=>{
 const low=createGraphicsSettings('low'),medium=createGraphicsSettings('medium'),high=createGraphicsSettings('high'),ultra=createGraphicsSettings('ultra');
 assert.ok(low.renderScale<medium.renderScale);
 assert.ok(medium.renderScale<high.renderScale);
 assert.ok(high.bloomIterations<ultra.bloomIterations);
 assert.ok(high.shadowOccluders<ultra.shadowOccluders);
 assert.ok(low.atmosphereSamples<medium.atmosphereSamples);
 assert.ok(medium.atmosphereSamples<high.atmosphereSamples);
 assert.ok(high.atmosphereSamples<ultra.atmosphereSamples);
 assert.equal(low.clouds,false);
 assert.equal(ultra.clouds,true);
});

import { ATMOSPHERE_FRAGMENT, CLOUD_FRAGMENT } from '../src/rendering/shaders/planet-effects.ts';

test('planet effects contain real view-ray scattering and procedural cloud shading',()=>{
 assert.ok(ATMOSPHERE_FRAGMENT.includes('for(int i=0;i<16;i++)'));
 assert.ok(ATMOSPHERE_FRAGMENT.includes('rayleighDepth'));
 assert.ok(ATMOSPHERE_FRAGMENT.includes('mieDepth'));
 assert.ok(CLOUD_FRAGMENT.includes('fbm(p)'));
 assert.ok(CLOUD_FRAGMENT.includes('uWind'));
 assert.ok(CLOUD_FRAGMENT.includes('uShadowVisibility'));
});

import { PLANET_SURFACE_VERTEX, PLANET_SURFACE_FRAGMENT } from '../src/rendering/shaders/planet-surface.ts';

test('planet surface shader restores distinct procedural maps and physically based lighting',()=>{
 assert.ok(PLANET_SURFACE_VERTEX.includes('aPosition*(1.0+relief)'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('continentField'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('craterBasin'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('distributionGGX'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uLightIntensities[i]/distanceSquared'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uCameraPosition-vPosition'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('if(uKind>5.5)'));
});


import { LightingEngine } from '../src/presentation/lighting-engine.ts';

test('point lights use inverse-square attenuation and expose independent source snapshots',()=>{
 const lighting=new LightingEngine();
 lighting.setPointLight('sun',[0,0,0],{intensity:22,color:[1,.96,.86]});
 lighting.setPointLight('secondary-star',[0,3,0],{intensity:4,color:[.5,.7,1]});
 assert.equal(lighting.getLights().length,2);
 assert.equal(lighting.intensityAt([1,0,0],'sun'),22);
 assert.equal(lighting.intensityAt([2,0,0],'sun'),5.5);
 const snapshot=lighting.getLights();
 assert.equal(snapshot.length,1);
 snapshot[0].position[0]=100;
 assert.deepEqual(lighting.getLight('sun')?.position,[0,0,0]);
});

test('planet surface shader supports multiple point lights and a non-emissive night side',()=>{
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uniform vec3 uLightPositions[4]'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('for(int i=0;i<4;i++)'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uLightIntensities[i]/distanceSquared'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('vec3 indirect=albedo*0.0001'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uSunRadius*along/max(sunDistance-along,1e-12)'));
});

test('atmosphere and cloud shaders receive stellar irradiance independently of surface rendering',()=>{
 assert.ok(ATMOSPHERE_FRAGMENT.includes('uLightIntensity/22.0'));
 assert.ok(ATMOSPHERE_FRAGMENT.includes('smoothstep(-0.08,0.12,dot(n,lightDir))*uShadowVisibility'));
 assert.ok(CLOUD_FRAGMENT.includes('uLightIntensity/22.0'));
 assert.ok(CLOUD_FRAGMENT.includes('float lighting=diffuse*uShadowVisibility'));
});
