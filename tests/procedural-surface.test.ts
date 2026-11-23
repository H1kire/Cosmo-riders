import test from 'node:test';
import assert from 'node:assert/strict';
import { stableSeed,fbm3,ridged3,worley3,domainWarp3 } from '../src/rendering/procedural-surface/noise.ts';
import { createSurfaceProfile,sampleSurface,generateSurfaceCubeMaps,surfaceResolutionForProjectedRadius,cubeFaceDirection } from '../src/rendering/procedural-surface/surface-generator.ts';
import { SurfaceMapCache } from '../src/rendering/procedural-surface/surface-map-cache.ts';
import { CelestialBody } from '../src/physics/celestial-body.ts';

const earth={id:'earth',massKg:5.9722e24,meanRadiusM:6371000};
test('stable seeds and 3D noise are deterministic',()=>{
 const seed=stableSeed('planet-alpha-42');
 assert.equal(seed,stableSeed('planet-alpha-42'));
 assert.notEqual(seed,stableSeed('planet-alpha-43'));
 assert.equal(fbm3(.1,.2,.3,seed),fbm3(.1,.2,.3,seed));
 assert.notEqual(fbm3(.1,.2,.3,seed),fbm3(.1,.2,.3,seed+1));
 assert.ok(ridged3(.2,.4,.6,seed)>=0);
 assert.ok(worley3(.2,.4,.6,seed)>=0);
 assert.deepEqual(domainWarp3(1,2,3,seed),domainWarp3(1,2,3,seed));
});
test('physical profiles distinguish known worlds and accept persisted seeds',()=>{
 const e=createSurfaceProfile(earth),m=createSurfaceProfile({id:'mars',massKg:6.4171e23,meanRadiusM:3389500});
 assert.equal(e.class,'oceanic');assert.equal(m.class,'rocky');
 assert.ok(e.waterFraction>m.waterFraction);
 assert.equal(createSurfaceProfile({...earth,surfaceSeed:12345}).seed,12345);
});
test('surface samples are deterministic and reflect composition',()=>{
 const e=createSurfaceProfile(earth);
 const ice=createSurfaceProfile({id:'custom-ice',massKg:4e22,meanRadiusM:1e6,surface:{class:'icy',iceFraction:.95,temperatureK:80,waterFraction:.5}});
 assert.deepEqual(sampleSurface([1,0,0],e),sampleSurface([1,0,0],e));
 assert.equal(sampleSurface([1,0,0],ice).material,'ice');
 const gas=createSurfaceProfile({id:'custom-gas',massKg:1e27,meanRadiusM:7e7,surface:{class:'gas-giant'}});
 assert.equal(sampleSurface([0,1,0],gas).material,'ash');
});
test('cube-sphere maps are deterministic and sized per face',async()=>{
 const profile=createSurfaceProfile(earth),a=await generateSurfaceCubeMaps(profile,8),b=await generateSurfaceCubeMaps(profile,8);
 assert.deepEqual(a.albedo,b.albedo);assert.deepEqual(a.heightRoughness,b.heightRoughness);assert.deepEqual(a.normal,b.normal);
 assert.equal(a.albedo.length,6*8*8*4);
 assert.ok(a.albedo.every(v=>v>=0&&v<=255));assert.ok(a.normal.every(v=>v>=0&&v<=255));
});
test('surface LOD and cache memory remain bounded',async()=>{
 assert.equal(surfaceResolutionForProjectedRadius(5),64);
 assert.equal(surfaceResolutionForProjectedRadius(100),256);
 assert.equal(surfaceResolutionForProjectedRadius(600),512);
 const cache=new SurfaceMapCache(1000000),profile=createSurfaceProfile(earth);
 const a=await cache.get(profile,8),b=await cache.get(profile,8);
 assert.equal(a,b);assert.equal(cache.size,1);
 const changed={...profile,waterFraction:.01};await cache.get(changed,8);assert.equal(cache.size,2);
 assert.ok(cache.memoryBytes<=1000000);
 cache.clear();assert.equal(cache.size,0);
});

test('celestial bodies persist validated procedural surface seeds and composition',()=>{
 const body=new CelestialBody({id:'random-world-17',name:'Random World',massKg:5e24,meanRadiusM:6e6,surfaceSeed:987654,surface:{class:'volcanic',ironFraction:.42,volcanicActivity:.9,temperatureK:480}});
 const profile=createSurfaceProfile(body);
 assert.equal(profile.seed,987654);assert.equal(profile.class,'volcanic');assert.equal(profile.volcanicActivity,.9);
 assert.throws(()=>new CelestialBody({id:'bad-world',name:'Bad',massKg:1e20,meanRadiusM:1e6,surface:{waterFraction:1.5}}),/fraction/);
});

test('adjacent cube faces share identical spherical edge directions',()=>{
 const plusX=cubeFaceDirection(0,-1,.37),plusZ=cubeFaceDirection(4,1,.37);
 assert.ok(Math.hypot(plusX[0]-plusZ[0],plusX[1]-plusZ[1],plusX[2]-plusZ[2])<1e-12);
});
