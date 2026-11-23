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
 assert.equal(low.clouds,false);
 assert.equal(ultra.clouds,true);
});
