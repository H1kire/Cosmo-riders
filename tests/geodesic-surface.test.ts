import test from 'node:test';
import assert from 'node:assert/strict';
import { ICOSAHEDRON_FACES,barycentricDirection,baseGeoTiles,childrenOf,resolveGeoTile,tileId } from '../src/rendering/geodesic/icosphere.ts';
import { generateSurfaceTile,surfaceTileKey } from '../src/rendering/geodesic/surface-tile.ts';
import { createGeologicalProfile } from '../src/rendering/geodesic/surface-profile.ts';

const earth={id:'earth',massKg:5.9722e24,meanRadiusM:6371008.4,surfaceSeed:101,surface:{temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,tectonicActivity:.8,volcanicActivity:.32,erosion:.78,impactAge:.18},rotationPeriodSeconds:86164};
const profile=createGeologicalProfile(earth as never);

test('icosphere starts from exactly twenty normalized triangular faces',()=>{
 assert.equal(ICOSAHEDRON_FACES.length,20);
 for(const face of ICOSAHEDRON_FACES)for(const vertex of [face.a,face.b,face.c])assert.ok(Math.abs(Math.hypot(...vertex)-1)<1e-12);
});
test('geodesic subdivision creates four children and stable hierarchical identifiers',()=>{
 const root=baseGeoTiles()[0],children=childrenOf(root);
 assert.equal(children.length,4);
 assert.deepEqual(children.map(child=>child.id.key),['0:0','0:1','0:2','0:3']);
 assert.equal(resolveGeoTile(tileId(0,'231')).id.level,3);
 assert.throws(()=>tileId(20),/face/);assert.throws(()=>tileId(0,'4'),/path/);
});
test('adjacent icosahedron faces agree exactly along their shared edge',()=>{
 const a=ICOSAHEDRON_FACES[0],b=ICOSAHEDRON_FACES[1];
 for(let i=0;i<=32;i++){
  const t=i/32,da=barycentricDirection(a,0,t),db=barycentricDirection(b,t,0);
  assert.ok(Math.hypot(da[0]-db[0],da[1]-db[1],da[2]-db[2])<1e-12);
 }
});
test('geological profile is stable and uses measured body properties',()=>{
 const a=createGeologicalProfile(earth as never),b=createGeologicalProfile(earth as never);
 assert.deepEqual(a,b);assert.equal(a.kind,'oceanic');assert.equal(a.seed,101);
 assert.ok(Math.abs(a.gravityMS2-9.81)<.1);assert.equal(a.waterFraction,.71);
 const jupiter=createGeologicalProfile({id:'jupiter',massKg:1.8982e27,meanRadiusM:69911000,surfaceSeed:42,surface:{temperatureK:165,pressurePa:1e5},rotationPeriodSeconds:35730} as never);
 assert.equal(jupiter.kind,'gas-giant');
});
test('geodesic surface tiles are deterministic square virtual-texture pages',()=>{
 const request={planetId:'earth',seed:profile.seed,tile:tileId(0,'2'),resolution:16,gutter:2,profile};
 const a=generateSurfaceTile(request),b=generateSurfaceTile(request),size=20*20;
 assert.equal(a.key,surfaceTileKey(request));assert.deepEqual(a.albedo,b.albedo);assert.deepEqual(a.height,b.height);
 assert.equal(a.albedo.length,size*4);assert.equal(a.normal.length,size*3);assert.equal(a.height.length,size);
 assert.equal(a.roughness.length,size);assert.equal(a.materialId.length,size);
 assert.ok(a.generationMs>=0);assert.ok(a.height.some(value=>value!==0));
});
test('different physical seeds produce different geological tiles',()=>{
 const a=generateSurfaceTile({planetId:'earth',seed:profile.seed,tile:tileId(0),resolution:8,gutter:1,profile});
 const changed={...profile,seed:profile.seed+1};
 const b=generateSurfaceTile({planetId:'earth',seed:changed.seed,tile:tileId(0),resolution:8,gutter:1,profile:changed});
 assert.notDeepEqual(a.albedo,b.albedo);
});
test('gas giants generate zonal atmospheric materials without solid relief',()=>{
 const saturn=createGeologicalProfile({id:'saturn',massKg:5.6834e26,meanRadiusM:58232000,surfaceSeed:77,surface:{temperatureK:134,pressurePa:1e5},rotationPeriodSeconds:38362} as never);
 const tile=generateSurfaceTile({planetId:'saturn',seed:saturn.seed,tile:tileId(4),resolution:8,gutter:1,profile:saturn});
 assert.ok(tile.height.every(value=>value===0));
 assert.ok(tile.materialId.every(value=>value===10));
});
