import test from 'node:test';
import assert from 'node:assert/strict';
import { baseGeoTiles, buildTileDirections, childrenOf, resolveGeoTile, tileId } from '../src/rendering/geodesic/icosphere.ts';
import { generateSurfaceTile, squareToTriangleBarycentric, triangleToSquareUv, surfaceTileKey, type SurfaceProfile, type SurfaceTileRequest } from '../src/rendering/geodesic/surface-tile.ts';

const profile:SurfaceProfile={
 bodyId:'earth',seed:12345,kind:'oceanic',massKg:5.9722e24,meanRadiusM:6371000,gravityMS2:9.81,
 temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,
 silicateFraction:.62,volatileFraction:.03,sulfurFraction:.01,tectonicActivity:.8,
 volcanicActivity:.32,erosion:.78,age:.18,rotationPeriodSeconds:86164,algorithmVersion:1
};
const request=(overrides:Partial<SurfaceTileRequest>={}):SurfaceTileRequest=>({
 planetId:'earth',seed:profile.seed,tile:tileId(0,'123'),resolution:32,gutter:2,profile,...overrides
});

test('icosphere starts with twenty faces and recursively creates four stable children',()=>{
 const roots=baseGeoTiles();
 assert.equal(roots.length,20);
 for(const root of roots){
  const children=childrenOf(root);
  assert.equal(children.length,4);
  for(let i=0;i<4;i++){
   assert.equal(children[i].id.key,root.id.face.toString(36)+':'+(root.id.path+String(i)));
   assert.deepEqual(resolveGeoTile(children[i].id).triangle,children[i].triangle);
  }
 }
});

test('triangular direction grid allocates every generated vertex including its gutter rows',()=>{
 const tile=baseGeoTiles()[0],resolution=32,gutter=3;
 const directions=buildTileDirections(tile,resolution,gutter);
 const side=resolution+2*gutter;
 const expected=(side+1)*(side+2)/2*3;
 assert.equal(directions.length,expected);
 for(let i=0;i<directions.length;i+=3){
  const length=Math.hypot(directions[i],directions[i+1],directions[i+2]);
  assert.ok(Number.isFinite(length));
  assert.ok(Math.abs(length-1)<1e-6);
 }
});

test('tile cache identity changes whenever any generation-affecting profile field changes',()=>{
 const base=surfaceTileKey(request());
 const changes:Partial<SurfaceProfile>[]=[
  {bodyId:'earth-alt'},{seed:12346},{kind:'rocky'},{massKg:5.9e24},{meanRadiusM:6372000},
  {gravityMS2:9.82},{temperatureK:289},{pressurePa:101326},{waterFraction:.7},{iceFraction:.03},
  {ironFraction:.33},{silicateFraction:.61},{volatileFraction:.04},{sulfurFraction:.02},
  {tectonicActivity:.7},{volcanicActivity:.31},{erosion:.77},{age:.19},
  {rotationPeriodSeconds:90000},{algorithmVersion:2}
 ];
 for(const change of changes){
  assert.notEqual(surfaceTileKey(request({profile:{...profile,...change}})),base);
 }
 assert.notEqual(surfaceTileKey(request({planetId:'another-earth'})),base);
 assert.notEqual(surfaceTileKey(request({seed:profile.seed+1})),base);
 assert.notEqual(surfaceTileKey(request({tile:tileId(0,'122')})),base);
 assert.notEqual(surfaceTileKey(request({resolution:64})),base);
 assert.notEqual(surfaceTileKey(request({gutter:4})),base);
 assert.equal(surfaceTileKey(request()),base);
});

test('label renderer uses the computed distance opacity instead of forcing full opacity',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.ok(source.includes("node.style.opacity=String(p.labelOpacity??1)"));
 assert.ok(!source.includes("node.style.opacity='1'"));
});

test('square-to-triangle parameterization round-trips the full triangular domain',()=>{
 for(let row=0;row<=20;row++){
  for(let col=0;col<=20-row;col++){
   const u=col/20,v=row/20,[x,y]=triangleToSquareUv(u,v),[mappedU,mappedV]=squareToTriangleBarycentric(x,y);
   assert.ok(Math.abs(mappedU-u)<1e-10);
   assert.ok(Math.abs(mappedV-v)<1e-10);
  }
 }
 const corners=[[0,0],[1,0],[0,1]] as const;
 for(const [u,v] of corners){
  const [x,y]=triangleToSquareUv(u,v),[mappedU,mappedV]=squareToTriangleBarycentric(x,y);
  assert.ok(Math.abs(mappedU-u)<1e-10&&Math.abs(mappedV-v)<1e-10);
 }
});

test('geodesic tile generation fills every square page texel and produces finite global-field normals',()=>{
 const tile=generateSurfaceTile(request({tile:tileId(0,'')} as Partial<SurfaceTileRequest>));
 const count=(tile.resolution+tile.gutter*2)**2;
 assert.equal(tile.albedo.length,count*4);
 assert.equal(tile.normal.length,count*3);
 assert.equal(tile.height.length,count);
 assert.equal(tile.roughness.length,count);
 assert.equal(tile.materialId.length,count);
 assert.ok(tile.height.every(Number.isFinite));
 for(let i=0;i<tile.normal.length;i+=3){
  const nx=tile.normal[i]/255*2-1,ny=tile.normal[i+1]/255*2-1,nz=tile.normal[i+2]/255*2-1;
  const length=Math.hypot(nx,ny,nz);
  assert.ok(Number.isFinite(length)&&length>.97&&length<1.03);
 }
});
