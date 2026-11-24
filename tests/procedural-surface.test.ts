import test from 'node:test';
import assert from 'node:assert/strict';
import { stableSeed,fbm3,fbmPerlin3,ridged3,worley3,domainWarp3 } from '../src/rendering/procedural-surface/noise.ts';
import { createSurfaceProfile,sampleSurface,generateSurfaceCubeMaps,surfaceResolutionForProjectedRadius,cubeFaceDirection,surfaceProfileKey } from '../src/rendering/procedural-surface/surface-generator.ts';
import { SurfaceMapCache } from '../src/rendering/procedural-surface/surface-map-cache.ts';
import { CelestialBody } from '../src/physics/celestial-body.ts';

const bodies={
 earth:{id:'earth',massKg:5.9722e24,meanRadiusM:6371000},
 moon:{id:'moon',massKg:7.342e22,meanRadiusM:1737400},
 mars:{id:'mars',massKg:6.4171e23,meanRadiusM:3389500},
 mercury:{id:'mercury',massKg:3.3011e23,meanRadiusM:2439700},
 venus:{id:'venus',massKg:4.8675e24,meanRadiusM:6051800},
 jupiter:{id:'jupiter',massKg:1.898e27,meanRadiusM:69911000},
 saturn:{id:'saturn',massKg:5.683e26,meanRadiusM:58232000},
 uranus:{id:'uranus',massKg:8.681e25,meanRadiusM:25362000},
 neptune:{id:'neptune',massKg:1.024e26,meanRadiusM:24622000},
 io:{id:'io',massKg:8.932e22,meanRadiusM:1821600},
 europa:{id:'europa',massKg:4.8e22,meanRadiusM:1560800},
 titan:{id:'titan',massKg:1.345e23,meanRadiusM:2574700}
};
test('stable seeds and 3D noise are deterministic',()=>{
 const seed=stableSeed('planet-alpha-42');
 assert.equal(seed,stableSeed('planet-alpha-42'));assert.notEqual(seed,stableSeed('planet-alpha-43'));
 assert.equal(fbm3(.1,.2,.3,seed),fbm3(.1,.2,.3,seed));assert.notEqual(fbm3(.1,.2,.3,seed),fbm3(.1,.2,.3,seed+1));
 assert.ok(ridged3(.2,.4,.6,seed)>=0);assert.ok(worley3(.2,.4,.6,seed)>=0);
 assert.deepEqual(domainWarp3(1,2,3,seed),domainWarp3(1,2,3,seed));
});
test('known bodies receive distinct physical surface classes and chemistry',()=>{
 const profiles=Object.fromEntries(Object.entries(bodies).map(([id,body])=>[id,createSurfaceProfile(body)]));
 assert.equal(profiles.earth.class,'oceanic');assert.equal(profiles.mars.class,'desert');
 assert.equal(profiles.moon.class,'airless-moon');assert.equal(profiles.mercury.class,'airless-moon');
 assert.equal(profiles.venus.class,'dense-atmosphere');assert.equal(profiles.jupiter.class,'gas-giant');
 assert.equal(profiles.saturn.class,'gas-giant');assert.equal(profiles.uranus.class,'ice-giant');assert.equal(profiles.neptune.class,'ice-giant');
 assert.equal(profiles.io.class,'volcanic-moon');assert.equal(profiles.europa.class,'icy-moon');assert.equal(profiles.titan.class,'dense-atmosphere');
 assert.ok(profiles.earth.waterFraction>profiles.mars.waterFraction);
 assert.ok(profiles.mercury.metalFraction>profiles.moon.metalFraction);
 assert.ok(profiles.io.sulfurFraction>profiles.mars.sulfurFraction);
 assert.ok(profiles.titan.hydrocarbonFraction>0);
 assert.equal(profiles.earth.mineralFlags.ironOxides,true);assert.equal(profiles.io.mineralFlags.sulfides,true);
 assert.equal(profiles.titan.mineralFlags.organics,true);assert.equal(profiles.mercury.mineralFlags.carbon,true);
 const gasExoplanet=createSurfaceProfile({id:'exoplanet-gas',massKg:1e27,meanRadiusM:7e7});
 const iceExoplanet=createSurfaceProfile({id:'exoplanet-ice',massKg:1e26,meanRadiusM:2.5e7});
 assert.equal(gasExoplanet.class,'gas-giant');assert.equal(iceExoplanet.class,'ice-giant');
 assert.equal(gasExoplanet.silicateFraction,0);assert.equal(iceExoplanet.ironFraction,0);
});
test('surface samples use class-specific material families and composition',()=>{
 const earth=createSurfaceProfile(bodies.earth),mars=createSurfaceProfile(bodies.mars),moon=createSurfaceProfile(bodies.moon);
 const gas=createSurfaceProfile(bodies.jupiter),iceGiant=createSurfaceProfile(bodies.neptune);
 const io=createSurfaceProfile(bodies.io),europa=createSurfaceProfile(bodies.europa),titan=createSurfaceProfile(bodies.titan);
 const direction:[number,number,number]=[1,.17,.31];
 assert.deepEqual(sampleSurface(direction,earth),sampleSurface(direction,earth));
 assert.notDeepEqual(sampleSurface(direction,earth).albedo,sampleSurface(direction,mars).albedo);
 assert.notDeepEqual(sampleSurface(direction,moon).albedo,sampleSurface(direction,mars).albedo);
 assert.equal(sampleSurface(direction,gas).material,'cloud');
 assert.equal(sampleSurface(direction,iceGiant).material,'cloud');
 assert.notDeepEqual(sampleSurface(direction,gas).albedo,sampleSurface(direction,createSurfaceProfile(bodies.saturn)).albedo);
 assert.notDeepEqual(sampleSurface(direction,iceGiant).albedo,sampleSurface(direction,createSurfaceProfile(bodies.uranus)).albedo);
 assert.ok(sampleSurface(direction,io).material==='sulfur'||sampleSurface(direction,io).material==='lava');
 assert.equal(sampleSurface(direction,europa).material,'water-ice');
 assert.ok(sampleSurface(direction,titan).material==='hydrocarbon'||sampleSurface(direction,titan).material==='water-ice');
});
test('unknown worlds infer dense atmospheres and accept explicit composition overrides',()=>{
 const dense=createSurfaceProfile({id:'exoworld-a',massKg:5e24,meanRadiusM:6e6,surface:{temperatureK:500,pressurePa:2e6,metalFraction:.3,mineralComposition:['iron','silicate']}});
 assert.equal(dense.class,'dense-atmosphere');assert.equal(dense.metalFraction,.3);assert.deepEqual(dense.mineralComposition,['iron','silicate']);
 const titanLike=createSurfaceProfile({id:'titan-like',massKg:1.2e23,meanRadiusM:2.4e6,surface:{temperatureK:94,pressurePa:146000,iceFraction:.7,hydrocarbonFraction:.3}});
 assert.equal(titanLike.class,'dense-atmosphere');
 const seeded=createSurfaceProfile({...bodies.earth,surfaceSeed:12345});
 assert.equal(seeded.seed,12345);
});
test('cube-sphere maps expose independent PBR channels and are deterministic',async()=>{
 const profile=createSurfaceProfile(bodies.earth),a=await generateSurfaceCubeMaps(profile,8),b=await generateSurfaceCubeMaps(profile,8);
 assert.deepEqual(a.albedo,b.albedo);assert.deepEqual(a.height,b.height);assert.deepEqual(a.roughness,b.roughness);assert.deepEqual(a.normal,b.normal);
 assert.equal(a.albedo.length,6*8*8*4);assert.equal(a.height.length,6*8*8);assert.equal(a.roughness.length,6*8*8);assert.equal(a.normal.length,6*8*8*3);
 for(const channel of [a.albedo,a.height,a.roughness,a.normal])assert.ok(channel.every(v=>v>=0&&v<=255));
 assert.equal(a.resolution,8);assert.equal(a.heightResolution,8);assert.equal(a.roughnessResolution,8);assert.equal(a.normalResolution,8);assert.ok(a.generationMs>=0);
});
test('atmospheric giants do not receive geological relief normals',async()=>{
 const maps=await generateSurfaceCubeMaps(createSurfaceProfile(bodies.jupiter),8);
 for(let i=0;i<maps.height.length;i++){assert.equal(maps.height[i],128);}
 for(let i=0;i<maps.normal.length;i+=3){const nx=maps.normal[i]/255*2-1,ny=maps.normal[i+1]/255*2-1,nz=maps.normal[i+2]/255*2-1;assert.ok(Math.abs(Math.hypot(nx,ny,nz)-1)<.02);}
});
test('surface LOD and worker-backed cache remain bounded and deduplicate requests',async()=>{
 assert.equal(surfaceResolutionForProjectedRadius(5),64);assert.equal(surfaceResolutionForProjectedRadius(20),128);assert.equal(surfaceResolutionForProjectedRadius(100),256);assert.equal(surfaceResolutionForProjectedRadius(200),512);assert.equal(surfaceResolutionForProjectedRadius(400),1024);assert.equal(surfaceResolutionForProjectedRadius(600),2048);assert.equal(surfaceResolutionForProjectedRadius(800),2048);
 assert.equal(surfaceResolutionForProjectedRadius(40,'gas-giant'),128);assert.equal(surfaceResolutionForProjectedRadius(40,'icy-moon'),256);
 const cache=new SurfaceMapCache(1000000),profile=createSurfaceProfile(bodies.earth);
 const [a,b]=await Promise.all([cache.get(profile,8),cache.get(profile,8)]);
 assert.equal(a,b);assert.equal(cache.size,1);
 const changed={...profile,waterFraction:.01};assert.notEqual(surfaceProfileKey(changed),surfaceProfileKey(profile));
 await cache.get(changed,8);assert.equal(cache.size,2);assert.ok(cache.memoryBytes<=1000000);
 cache.clear();assert.equal(cache.size,0);cache.dispose();
});
test('cube face edges remain geometrically continuous',()=>{
 const plusX=cubeFaceDirection(0,-1,.37),plusZ=cubeFaceDirection(4,1,.37);
 assert.ok(Math.hypot(plusX[0]-plusZ[0],plusX[1]-plusZ[1],plusX[2]-plusZ[2])<1e-12);
});
test('celestial bodies persist and validate surface metadata',()=>{
 const body=new CelestialBody({id:'random-world-17',name:'Random World',massKg:5e24,meanRadiusM:6e6,surfaceSeed:987654,surface:{class:'volcanic-moon',ironFraction:.42,volcanicActivity:.9,temperatureK:480,metalFraction:.2,mineralComposition:['basalt','sulfides']}});
 const profile=createSurfaceProfile(body);
 assert.equal(profile.seed,987654);assert.equal(profile.class,'volcanic-moon');assert.equal(profile.volcanicActivity,.9);
 assert.throws(()=>new CelestialBody({id:'bad-world',name:'Bad',massKg:1e20,meanRadiusM:1e6,surface:{waterFraction:1.5}}),/fraction/);
});

test('geological classes produce distinct relief fields rather than recolored shared terrain',()=>{
 const seed=481516;
 const make=(id:string,cls:any,extra:any={})=>createSurfaceProfile({id,massKg:5.9e24,meanRadiusM:6.4e6,surfaceSeed:seed,surface:{class:cls,temperatureK:extra.temperatureK??260,pressurePa:extra.pressurePa??0,tectonicActivity:extra.tectonicActivity??.65,volcanicActivity:extra.volcanicActivity??.55,impactAge:extra.impactAge??.7,erosion:extra.erosion??.25,waterFraction:extra.waterFraction??0,iceFraction:extra.iceFraction??0,volatileFraction:extra.volatileFraction??.05,hydrocarbonFraction:extra.hydrocarbonFraction??0,mineralComposition:extra.mineralComposition??['silicates']}});
 const direction:[number,number,number]=[.31,.72,-.44];
 const samples=['rocky','oceanic','desert','icy','volcanic','airless-moon'].map(cls=>sampleSurface(direction,make('world-'+cls,cls)));
 assert.equal(new Set(samples.map(s=>s.height.toFixed(6))).size,samples.length);
});
test('Perlin gradient noise is deterministic and bounded',()=>{
 const a=fbmPerlin3(.13,.27,.39,1234,5);
 assert.equal(a,fbmPerlin3(.13,.27,.39,1234,5));
 assert.notEqual(a,fbmPerlin3(.13,.27,.39,1235,5));
 assert.ok(a>=0&&a<=1);
});

test('surface cache identity depends on generated data rather than display id',()=>{
 const profile=createSurfaceProfile(bodies.earth);
 const renamed={...profile,id:'earth-copy'};
 assert.equal(surfaceProfileKey(profile),surfaceProfileKey(renamed));
});
test('gas and ice giant atmospheric fields are driven by physical profile values',()=>{
 const jupiter=createSurfaceProfile(bodies.jupiter),saturn=createSurfaceProfile(bodies.saturn);
 const uranus=createSurfaceProfile(bodies.uranus),neptune=createSurfaceProfile(bodies.neptune);
 const direction:[number,number,number]=[.21,.61,.44];
 assert.notDeepEqual(sampleSurface(direction,jupiter).albedo,sampleSurface(direction,saturn).albedo);
 assert.notDeepEqual(sampleSurface(direction,uranus).albedo,sampleSurface(direction,neptune).albedo);
 const generic=createSurfaceProfile({id:'generic-giant',massKg:1.9e27,meanRadiusM:7e7,surface:{class:'gas-giant',temperatureK:150,pressurePa:1e5,volatileFraction:.5,hydrocarbonFraction:.1,rotationFactor:.8}});
 assert.equal(sampleSurface(direction,generic).material,'cloud');
});

test('all reference Solar System bodies generate finite material maps',async()=>{
 const results=[];
 for(const [id,body] of Object.entries(bodies)){
  const profile=createSurfaceProfile(body);
  const maps=await generateSurfaceCubeMaps(profile,8);
  for(const channel of [maps.albedo,maps.height,maps.roughness,maps.normal]){
   assert.ok(channel.every(Number.isFinite),id+' contains non-finite map values');
  }
  assert.equal(maps.albedo.length,6*8*8*4);
  results.push({id,signature:maps.albedo.slice(0,96).join(',')});
 }
 assert.ok(new Set(results.map(item=>item.signature)).size>=9,'reference bodies should not collapse into a few shared texture templates');
});

test('planet shader keeps world-space noise frequencies independent of camera detail',async()=>{
 const {readFile}=await import('node:fs/promises');
 const shader=await readFile(new URL('../src/rendering/shaders/planet-surface.ts',import.meta.url),'utf8');
 assert.ok(shader.includes('domainWarp3(n*18.0+uSeed)'));
 assert.ok(shader.includes('domainWarp3(n*7.0+uSeed*2.7)'));
 assert.ok(shader.includes('fbm3Filtered(n*8.0+uSeed*5.1)'));
 assert.ok(shader.includes('fbm3Filtered(n*18.0+uSeed*3.0)'));
 assert.ok(shader.includes('fwidth(p.x)'));
 assert.ok(!shader.includes('n*(18.0+uDetail*54.0)'));
 assert.ok(!shader.includes('n*(7.0+uDetail*6.0)'));
 assert.ok(!shader.includes('n*(8.0+uDetail*42.0)'));
});

test('UV fallback and geodesic pages resolve the same deterministic body seed',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 const profile=await readFile(new URL('../src/rendering/geodesic/surface-profile.ts',import.meta.url),'utf8');
 assert.ok(source.includes('body.surfaceSeed??surfaceSeedForId(body.id)'));
 assert.ok(source.includes('seed:body.surfaceSeed??surfaceSeedForId(body.id)'));
 assert.ok(profile.includes('seed=body.surfaceSeed??stableSeed(body.id)'));
});
