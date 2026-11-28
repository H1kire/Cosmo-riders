import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEclipse } from '../src/rendering/lighting/eclipse-system.ts';
import { solarIrradianceForDisplay } from '../src/rendering/lighting/lighting-system.ts';
import { bodyModelMatrix } from '../src/presentation/solar-3d.ts';
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
 assert.equal(createGraphicsSettings('ultra').shadowOccluders,8);
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
 assert.equal(high.maxMeshLod,3);
 assert.equal(ultra.maxMeshLod,3);
 assert.equal(low.msaaSamples,1);
 assert.equal(medium.msaaSamples,1);
 assert.equal(high.msaaSamples,4);
 assert.equal(ultra.msaaSamples,4);
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
 assert.ok(CLOUD_FRAGMENT.includes('fbmFiltered'));
 assert.ok(CLOUD_FRAGMENT.includes('fwidth(p.x)'));
 assert.ok(CLOUD_FRAGMENT.includes('uWind'));
 assert.ok(CLOUD_FRAGMENT.includes('localShadowVisibility(vPosition)'));
});

import { PLANET_SURFACE_VERTEX, PLANET_SURFACE_FRAGMENT } from '../src/rendering/shaders/planet-surface.ts';
import { CLOUD_VERTEX } from '../src/rendering/shaders/planet-effects.ts';
import { focusedSolarExposureMultiplier, planetaryDisplayGain } from '../src/rendering/lighting/lighting-system.ts';




import { LightingEngine } from '../src/presentation/lighting-engine.ts';

test('point lights use inverse-square attenuation and expose independent source snapshots',()=>{
 const lighting=new LightingEngine();
 lighting.setPointLight('sun',[0,0,0],{intensity:22,color:[1,.96,.86]});
 lighting.setPointLight('secondary-star',[0,3,0],{intensity:4,color:[.5,.7,1]});
 assert.equal(lighting.getLights().length,2);
 assert.equal(lighting.intensityAt([1,0,0],'sun'),22);
 assert.equal(lighting.intensityAt([2,0,0],'sun'),5.5);
 const snapshot=lighting.getLights();
 assert.equal(snapshot.length,2);
 const sunSnapshot=snapshot.find(source=>source.id==='sun');
 assert.ok(sunSnapshot);
 sunSnapshot.position[0]=100;
 assert.deepEqual(lighting.getLight('sun')?.position,[0,0,0]);
 assert.deepEqual(lighting.getLight('secondary-star')?.position,[0,3,0]);
});

test('planet surface shader supports multiple point lights and a non-emissive night side',()=>{
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uniform vec3 uLightPositions[4]'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('for(int i=0;i<4;i++)'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uLightIntensities[i]/(22.0*distanceSquared)'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('vec3 indirect=albedo*0.0001'));
 assert.ok(PLANET_SURFACE_FRAGMENT.includes('uSunRadius*along/max(sunDistance-along,1e-12)'));
});

test('atmosphere and cloud shaders receive stellar irradiance independently of surface rendering',()=>{
 assert.ok(ATMOSPHERE_FRAGMENT.includes('uLightIntensity/22.0'));
 assert.ok(ATMOSPHERE_FRAGMENT.includes('visibilitySum+=localShadowVisibility(samplePosition)'));
 assert.ok(CLOUD_FRAGMENT.includes('uLightIntensity/22.0'));
 assert.ok(CLOUD_FRAGMENT.includes('float lighting=diffuse*localShadowVisibility(vPosition)'));
});


import { LightingSystem } from '../src/rendering/lighting/lighting-system.ts';

test('solar lighting system preserves the primary star and supports additional point sources',()=>{
 const lighting=new LightingSystem();
 lighting.addSource({id:'sun',kind:'point',position:[0,0,0],intensity:22,color:[1,.96,.86]});
 lighting.addSource({id:'binary-companion',kind:'point',position:[3,0,0],intensity:6,color:[.7,.8,1]});
 lighting.updateSource('sun',{position:[1,0,0]});
 const lights=lighting.getLights();
 assert.equal(lights.length,2);
 assert.deepEqual(lights.find(light=>light.id==='sun')?.position,[1,0,0]);
 assert.equal(lighting.getSources().length,2);
});

import { selectMeshLod, planetaryOrbitOpacity, planetaryLabelOpacity, projectedOrbitRadius } from '../src/rendering/quality/render-lod.ts';

test('screen-space mesh LOD increases detail only when projected size requires it',()=>{
 assert.equal(selectMeshLod(8,3),0);
 assert.equal(selectMeshLod(40,3),1);
 assert.equal(selectMeshLod(180,3),2);
 assert.equal(selectMeshLod(900,3),3);
 assert.equal(selectMeshLod(900,1),1);
});

test('each planetary and satellite orbit can use the same smooth body-distance fade as its label',()=>{
 const radius=6371000/149597870700;
 assert.equal(planetaryOrbitOpacity(radius*20,radius),0);
 assert.equal(planetaryOrbitOpacity(radius*120,radius),0);
 assert.ok(planetaryOrbitOpacity(radius*1000,radius)>0);
 assert.equal(planetaryOrbitOpacity(radius*2400,radius),1);
 assert.equal(planetaryOrbitOpacity(1,0),1);
 assert.equal(planetaryLabelOpacity(radius*1000,radius),planetaryOrbitOpacity(radius*1000,radius));
});

test('projected orbit radius provides a continuous sub-pixel fade input',()=>{
 const distant=projectedOrbitRadius(0.0026,1080,38);
 const local=projectedOrbitRadius(0.0026,1080,0.00001);
 assert.ok(distant<0.8);
 assert.ok(local>100);
 assert.equal(projectedOrbitRadius(0,1080,1),0);
});

test('body labels use the same smooth distance curve as orbit lines',()=>{
 const radius=6371000/149597870700;
 assert.equal(planetaryLabelOpacity(radius*20,radius),0);
 assert.equal(planetaryLabelOpacity(radius*120,radius),0);
 assert.ok(planetaryLabelOpacity(radius*1000,radius)>0&&planetaryLabelOpacity(radius*1000,radius)<1);
 assert.equal(planetaryLabelOpacity(radius*2400,radius),1);
 assert.equal(planetaryLabelOpacity(1,0),1);
});
test('planet surfaces are generated directly from continuous spherical shader fields',()=>{
 const source=PLANET_SURFACE_VERTEX+'\\n'+PLANET_SURFACE_FRAGMENT;
 assert.ok(source.includes('vSurfaceDirection=n'));
 assert.ok(source.includes('normalize(vNormal)'));
 assert.ok(source.includes('domainWarp3(n*2.15'));
 assert.ok(source.includes('float land=smoothstep(0.486,0.516,continentField)'));
 assert.ok(source.includes('float softBelts=smoothstep(-0.48,0.58,belts)'));
 assert.ok(!source.includes('samplerCube'));
 assert.ok(!source.includes('uGeneratedAlbedo'));
});

test('planet material noise is branch-local and avoids redundant FBM evaluation for every fragment',()=>{
 const source=PLANET_SURFACE_FRAGMENT,begin=source.indexOf('vec3 surfaceAlbedo'),end=source.indexOf('float distributionGGX',begin),block=source.slice(begin,end),common=block.slice(0,block.indexOf('if(uKind<0.5)'));
 assert.ok(!/fbm3|ridged3|domainWarp3/.test(common));
 assert.ok(!block.includes('float tectonics='));assert.ok(!block.includes('float ridges='));
 assert.ok(block.includes('float medium=fbm3(domainWarp3(n*7.0+uSeed*2.7))'));
});

test('focused-body exposure compensates inverse-square solar dimming without changing the light law',()=>{
 assert.equal(focusedSolarExposureMultiplier(1),1);
 assert.equal(focusedSolarExposureMultiplier(5.2),1);
 assert.equal(focusedSolarExposureMultiplier(30),1);
 assert.equal(focusedSolarExposureMultiplier(50),1);
 assert.equal(focusedSolarExposureMultiplier(0),1);
 assert.equal(planetaryDisplayGain(1),1);
 assert.ok(planetaryDisplayGain(5.2)>1&&planetaryDisplayGain(5.2)<12);
 assert.equal(planetaryDisplayGain(30),64);
});
test('cloud density fields are sampled in body-local coordinates while lighting uses world normals',()=>{
 assert.ok(CLOUD_VERTEX.includes('vLocalNormal=aNormal'));
 assert.ok(CLOUD_FRAGMENT.includes('localDirection=safeNormalize(vLocalNormal)'));
 assert.ok(CLOUD_FRAGMENT.includes('vec3 n=safeNormalize(vNormal)'));
});


test('solar display irradiance preserves inverse-square falloff with bounded distant-body compensation',()=>{
 assert.equal(solarIrradianceForDisplay(1),1);
 assert.equal(solarIrradianceForDisplay(2),planetaryDisplayGain(2)/4);
 assert.ok(solarIrradianceForDisplay(2)>1/4,'display compensation is separate from physical inverse-square falloff');
 assert.ok(Math.abs(solarIrradianceForDisplay(5.2)-planetaryDisplayGain(5.2)/(5.2*5.2))<1e-12);
 assert.ok(solarIrradianceForDisplay(5.2)<1,'Jupiter remains dimmer than a body at 1 AU');
 assert.ok(Math.abs(solarIrradianceForDisplay(30)-64/900)<1e-12,'distant-body compensation is capped');
 assert.ok(solarIrradianceForDisplay(30)<solarIrradianceForDisplay(5.2),'outer planets remain dimmer than Jupiter');
});

test('active cloud shader keeps solar angular radius separate from cloud banding',async()=>{
 const {readFile}=await import('node:fs/promises');
 const backend=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
 assert.ok(backend.includes('let banding = clamp(body.lightAndEmission.w, 0.0, 1.0)'));
 assert.ok(backend.includes('shell.set([body.gasGiant?.type ?? 0, body.gasGiant?.bandStrength ?? 0, body.gasGiant?.stormStrength ?? 0, cloudBanding], 36)'));
 assert.ok(backend.includes('[solarIrradiance, 1, frame.sunRadius ?? 0,'));
 assert.ok(backend.includes('cloud.erosion, cloud.banding)'));
 assert.ok(!backend.includes('shell[39] = 1'));
});


test('active atmosphere profiles use per-body Rayleigh and Mie scale heights',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.ok(source.includes("id:'earth',height:110000"));
 assert.ok(source.includes('rayleighScaleHeightM:8400,mieScaleHeightM:1200'));
 assert.ok(source.includes('rayleighScaleHeightM:20000,mieScaleHeightM:9000'));
 assert.ok(source.includes('rayleighScaleHeightM:15900,mieScaleHeightM:6500'));
 assert.ok(!source.includes('rayleighScaleHeightM:height*.12'));
 assert.ok(!source.includes('mieScaleHeightM:height*.08'));
});


test('sphere mesh LOD uses the active internal render scale',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.ok(source.includes('radius*(h*this.graphics.renderScale/2)'));
 assert.ok(!source.includes('radius*(h/2)'));
});


test('tidal body orientation preserves its IAU spin pole and prime-meridian phase',()=>{
 const epsilon=23.4392911*Math.PI/180;
 const body={tidalLock:true,poleRightAscensionRad:Math.PI/2,poleDeclinationRad:0,axialTiltRad:0,primeMeridianRad:0};
 const state={position:{x:1,y:0,z:0},velocity:{x:0,y:1,z:0}};
 const parent={position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0}};
 const matrix=bodyModelMatrix(body,1,[0,0,0],0,state,parent,0);
 const spinAxis=[matrix[1],matrix[5],matrix[9]],forward=[matrix[2],matrix[6],matrix[10]];
 const expected=[0,-Math.sin(epsilon),Math.cos(epsilon)];
 assert.ok(Math.hypot(...spinAxis.map((value,index)=>value-expected[index]))<1e-12);
 const phased=bodyModelMatrix({...body,primeMeridianRad:Math.PI/2},1,[0,0,0],0,state,parent,0);
 const phasedAxis=[phased[1],phased[5],phased[9]],phasedForward=[phased[2],phased[6],phased[10]];
 assert.ok(Math.hypot(...phasedAxis.map((value,index)=>value-expected[index]))<1e-12);
 assert.ok(Math.abs(forward.reduce((sum,value,index)=>sum+value*phasedForward[index],0))<1e-12);
});


test('orbit path resampling interpolates source vertices instead of duplicating nearest samples',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.ok(source.includes('sourcePosition=i*sourceSegments/segments'));
 assert.ok(source.includes('source[a]+(source[b]-source[a])*blend'));
 assert.ok(!source.includes('Math.round(i*sourceSegments/segments)'));
});
