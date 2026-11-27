import test from 'node:test';
import assert from 'node:assert/strict';
import { ICOSAHEDRON_FACES,barycentricDirection,baseGeoTiles,childrenOf,resolveGeoTile,tileId } from '../src/rendering/geodesic/icosphere.ts';
import { generateSurfaceTile,surfaceTileKey } from '../src/rendering/geodesic/surface-tile.ts';
import { isSpherePotentiallyVisibleInFrustum } from '../src/rendering/geodesic/quadtree-selector.ts';
import { createGeologicalProfile } from '../src/rendering/geodesic/surface-profile.ts';

const earth={id:'earth',massKg:5.9722e24,meanRadiusM:6371008.4,surfaceSeed:101,surface:{temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,tectonicActivity:.8,volcanicActivity:.32,erosion:.78,impactAge:.18},rotationPeriodSeconds:86164};
const profile=createGeologicalProfile(earth as never);

test('whole-body frustum culling keeps intersecting spheres and rejects off-screen planets',()=>{
 const fov=Math.PI/3;
 assert.equal(isSpherePotentiallyVisibleInFrustum([0,0,10],[0,0,-1],1,fov,1600,900),true);
 assert.equal(isSpherePotentiallyVisibleInFrustum([0,0,10],[0,0,1],1,fov,1600,900),false);
 assert.equal(isSpherePotentiallyVisibleInFrustum([0,0,10],[1,0,0],1,fov,1600,900),false);
 assert.equal(isSpherePotentiallyVisibleInFrustum([0,0,.5],[0,0,1],1,fov,1600,900),true);
 assert.equal(isSpherePotentiallyVisibleInFrustum([0,0,10],[.7,0,-.7],1,fov,3200,900),true);
});

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


test('surface normals derive from the same displaced height samples without resampling geology',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/rendering/geodesic/surface-tile.ts',import.meta.url),'utf8');
 assert.ok(source.includes('const sample=sampleDirection(direction,tile.level)'));
 assert.ok(source.includes('displacedPositions'));
 assert.ok(source.includes('Нормаль отримується з похідних уже зміщеної геометрії'));
 assert.ok(!source.includes('const sampleHeight='));
 assert.ok(!source.includes('oceanicHeightSample'));
 const tile=generateSurfaceTile({planetId:'earth',seed:profile.seed,tile:tileId(0,'1'),resolution:16,gutter:2,profile});
 for(let index=0;index<tile.normal.length;index+=3){
  const nx=tile.normal[index]/127.5-1,ny=tile.normal[index+1]/127.5-1,nz=tile.normal[index+2]/127.5-1;
  assert.ok(Math.abs(Math.hypot(nx,ny,nz)-1)<.02,'surface normal must remain normalized');
 }
});

test('surface relief stays inside body-specific physical elevation limits',()=>{
 const cases=[
  {body:earth,limit:11000},
  {body:{id:'mars',massKg:6.4171e23,meanRadiusM:3389500,surfaceSeed:17},limit:22000},
  {body:{id:'europa',massKg:4.8e22,meanRadiusM:1560800,surfaceSeed:18},limit:3000}
 ];
 for(const item of cases){
  const p=createGeologicalProfile(item.body as never);
  const generated=generateSurfaceTile({planetId:p.bodyId,seed:p.seed,tile:tileId(0,'1'),resolution:24,gutter:2,profile:p});
  assert.ok(generated.height.every(value=>Number.isFinite(value)&&Math.abs(value)<=item.limit+1e-3),p.bodyId+' exceeded physical relief limits');
  assert.ok(generated.height.some(value=>Math.abs(value)<item.limit*.8),p.bodyId+' terrain appears clamped across the whole tile');
 }
});

test('higher geodesic LOD reveals deterministic additional microdetail',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/rendering/geodesic/surface-tile.ts',import.meta.url),'utf8');
 const rootRequest={planetId:'earth',seed:profile.seed,tile:tileId(0),resolution:64,gutter:1,profile};
 const root=generateSurfaceTile(rootRequest),repeat=generateSurfaceTile(rootRequest);
 const child=generateSurfaceTile({...rootRequest,tile:tileId(0,'0')});
 assert.deepEqual(root.height,repeat.height,'surface generation must remain deterministic');
 assert.ok(root.height.every(Number.isFinite)&&child.height.every(Number.isFinite));
 assert.notDeepEqual(root.height,child.height);
 assert.ok(source.includes('Math.min(6,lodLevel+1)'),'microdetail octave count must follow geodesic LOD');
 assert.ok(root.height.some(value=>Math.abs(value)<9000),'root relief must preserve natural elevation variation instead of saturating the cap');
 assert.equal(createGeologicalProfile(earth as never).algorithmVersion,2);
});
