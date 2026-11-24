import test from 'node:test';
import assert from 'node:assert/strict';
import { baseGeoTiles, buildTileDirections, childrenOf, resolveGeoTile, tileId, tileDirectionVertexCount, ICOSAHEDRON_ADJACENCY, ICOSAHEDRON_FACE_INDICES } from '../src/rendering/geodesic/icosphere.ts';
import { generateSurfaceTile, squareToTriangleBarycentric, triangleToSquareUv, surfaceTileKey, type SurfaceProfile, type SurfaceTileRequest } from '../src/rendering/geodesic/surface-tile.ts';
import { SurfaceTileWorkerPool } from '../src/rendering/geodesic/surface-worker-pool.ts';
import { findTileNeighbors } from '../src/rendering/geodesic/tile-neighbors.ts';
import { balanceGeodesicTiles } from '../src/rendering/geodesic/quadtree-balancer.ts';
import { selectGeodesicLod } from '../src/rendering/geodesic/quadtree-selector.ts';
import { buildStitchIndexTemplate, triangleGridVertexIndex } from '../src/rendering/geodesic/tile-stitching.ts';
import { buildGeodesicTileMesh } from '../src/rendering/geodesic/tile-mesh.ts';

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
 const expected=tileDirectionVertexCount(resolution,gutter)*3;
 assert.equal(directions.length,expected);
 for(let i=0;i<directions.length;i+=3){
  const length=Math.hypot(directions[i],directions[i+1],directions[i+2]);
  assert.ok(Number.isFinite(length));
  assert.ok(Math.abs(length-1)<1e-6);
 }
});

test('gutter grid writes every vertex for gutter widths 0, 1, 2, 3 and 8',()=>{
 const tile=baseGeoTiles()[0],resolution=32;
 for(const gutter of [0,1,2,3,8]){
  const directions=buildTileDirections(tile,resolution,gutter);
  const expected=tileDirectionVertexCount(resolution,gutter);
  assert.equal(directions.length,expected*3);
  let count=0;
  for(let i=0;i<directions.length;i+=3){
   const x=directions[i],y=directions[i+1],z=directions[i+2],length=Math.hypot(x,y,z);
   assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z));
   assert.ok(Math.abs(length-1)<1e-6);
   count++;
  }
  assert.equal(count,expected);
 }
});

test('icosahedron topology has thirty two-owner edges and three reciprocal neighbors per face',()=>{
 assert.equal(ICOSAHEDRON_FACE_INDICES.length,20);
 assert.equal(ICOSAHEDRON_ADJACENCY.length,20);
 const owners=new Map<string,number>();
 for(const face of ICOSAHEDRON_FACE_INDICES){
  for(const [a,b] of [[face[0],face[1]],[face[1],face[2]],[face[2],face[0]]]){
   const key=a<b?a+':'+b:b+':'+a;owners.set(key,(owners.get(key)??0)+1);
  }
 }
 assert.equal(owners.size,30);
 for(const adjacency of ICOSAHEDRON_ADJACENCY){
  assert.equal(adjacency.edges.length,3);
  assert.equal(new Set(adjacency.edges.map(edge=>edge.face)).size,3);
  for(let edge=0;edge<3;edge++){
   const link=adjacency.edges[edge],reverse=ICOSAHEDRON_ADJACENCY[link.face].edges[link.edge];
   assert.equal(reverse.face,adjacency.face);
   assert.equal(reverse.edge,edge);
   assert.equal(link.reversed,true);
  }
 }
});

test('base-face neighbor lookup is reciprocal across all thirty icosahedron edges',()=>{
 const roots=baseGeoTiles(),map=findTileNeighbors(roots);
 assert.equal(map.links.length,60);
 for(const tile of roots){
  const neighbors=map.byTile.get(tile.id.key)??[];
  assert.equal(neighbors.length,3);
  for(const link of neighbors){
   assert.ok((map.byTile.get(link.neighbor.id.key)??[]).some(reverse=>reverse.neighbor.id.key===tile.id.key&&reverse.edge===link.neighborEdge&&reverse.neighborEdge===link.edge));
  }
 }
});

test('neighbor lookup detects fine children along a coarse edge across base faces',()=>{
 const roots=baseGeoTiles(),root=roots[0],adjacentFace=ICOSAHEDRON_ADJACENCY[0].edges[0].face;
 const adjacentRoot=roots[adjacentFace],children=childrenOf(adjacentRoot);
 const firstMap=findTileNeighbors([root,...children]);
 const touching=firstMap.links.filter(link=>link.tile.id.key===root.id.key);
 assert.equal(touching.length,2);
 const fine=childrenOf(touching[0].neighbor);
 const mixed=findTileNeighbors([root,...children.filter(child=>child.id.key!==touching[0].neighbor.id.key),...fine]);
 assert.ok(mixed.links.some(link=>link.tile.id.key===root.id.key&&link.neighbor.id.level===2));
});

test('2:1 balancer refines coarse leaves and reports remaining constraints',()=>{
 const roots=baseGeoTiles(),root=roots[0],adjacent=roots[ICOSAHEDRON_ADJACENCY[0].edges[0].face];
 const adjacentChildren=childrenOf(adjacent),touching=findTileNeighbors([root,...adjacentChildren]).links.find(link=>link.tile.id.key===root.id.key)!.neighbor;
 const uneven=[...roots.filter(tile=>tile.id.key!==adjacent.id.key),...adjacentChildren.filter(tile=>tile.id.key!==touching.id.key),...childrenOf(touching)];
 const balanced=balanceGeodesicTiles(uneven,{maxDepth:8,maxTiles:2048});
 assert.equal(balanced.violations,0);
 assert.ok(balanced.splitOperations>0);
 assert.ok(balanced.maxLevelDifference<=1);
 assert.equal(new Set(balanced.tiles.map(tile=>tile.id.key)).size,balanced.tiles.length);
});

test('screen-space geodesic LOD splits near the surface and stays coarse at long range',()=>{
 const radius=6_371_000,base={forward:[0,0,-1] as const,verticalFovRadians:Math.PI/3,viewportHeightPx:1080,viewportWidthPx:1920};
 const far=selectGeodesicLod({...base,positionM:[0,0,radius*100]},{planetRadiusM:radius,maxDepth:5,maxTiles:1000,targetErrorPx:2});
 const near=selectGeodesicLod({...base,positionM:[0,0,radius*1.15]},{planetRadiusM:radius,maxDepth:5,maxTiles:1000,targetErrorPx:2});
 assert.ok(near.stats.split>far.stats.split);
 assert.ok(near.stats.maxLevel>far.stats.maxLevel);
 assert.ok(near.tiles.length<=1000);
});

test('all eight stitching masks produce valid positively wound triangles without odd coarse-edge vertices',()=>{
 const resolution=8,vertexCount=(resolution+1)*(resolution+2)/2;
 const coordinate=(index:number)=>{
  for(let row=0;row<=resolution;row++){
   const start=triangleGridVertexIndex(resolution,row,0),end=start+resolution-row;
   if(index>=start&&index<=end)return[row,index-start] as const;
  }
  throw new Error('Invalid triangle-grid index.');
 };
 for(let mask=0;mask<8;mask++){
  const indices=buildStitchIndexTemplate(resolution,mask);
  assert.ok(indices.length>0&&indices.length%3===0);
  const boundary=new Map<string,number>();
  const edgeCounts=new Map<string,number>();
  let totalDoubleArea=0;
  for(let i=0;i<indices.length;i+=3){
   const ids=[indices[i],indices[i+1],indices[i+2]];
   assert.ok(ids.every(index=>index<vertexCount));
   assert.equal(new Set(ids).size,3);
   const points=ids.map(coordinate),area=(points[1][1]-points[0][1])*(points[2][0]-points[0][0])-(points[1][0]-points[0][0])*(points[2][1]-points[0][1]);
   assert.ok(area>0);
   totalDoubleArea+=area;
   for(let e=0;e<3;e++){
    const a=points[e],b=points[(e+1)%3],key=ids[e]<ids[(e+1)%3]?ids[e]+':'+ids[(e+1)%3]:ids[(e+1)%3]+':'+ids[e];
    edgeCounts.set(key,(edgeCounts.get(key)??0)+1);
    const onAB=a[0]===0&&b[0]===0,onBC=a[0]+a[1]===resolution&&b[0]+b[1]===resolution,onCA=a[1]===0&&b[1]===0;
    if(onAB)boundary.set('AB:'+a[1],a[1]),boundary.set('AB:'+b[1],b[1]);
    if(onBC)boundary.set('BC:'+a[0],a[0]),boundary.set('BC:'+b[0],b[0]);
    if(onCA)boundary.set('CA:'+a[0],a[0]),boundary.set('CA:'+b[0],b[0]);
   }
  }
  for(const [key] of boundary){
   const [edge,coordinateText]=key.split(':'),value=Number(coordinateText);
   const bit=edge==='AB'?1:edge==='BC'?2:4;
   if(mask&bit)assert.equal(value%2,0);
  }
  assert.ok([...edgeCounts.values()].every(count=>count===1||count===2));
  assert.equal(totalDoubleArea,resolution*resolution,'stitching must preserve the complete triangle area without holes or overlaps');
 }
});

test('stitched index templates build outward-wound SI sphere meshes for all masks',()=>{
 const tile=baseGeoTiles()[0],radius=6_371_000,resolution=8;
 for(let mask=0;mask<8;mask++){
  const mesh=buildGeodesicTileMesh(tile,resolution,radius,mask);
  assert.equal(mesh.positionsM.length,mesh.directions.length);
  assert.equal(mesh.positionsM.length/3,(resolution+1)*(resolution+2)/2);
  assert.ok(mesh.indices.length>0);
  for(let i=0;i<mesh.positionsM.length;i+=3){
   const length=Math.hypot(mesh.positionsM[i],mesh.positionsM[i+1],mesh.positionsM[i+2]);
   assert.ok(Math.abs(length-radius)<1);
  }
  for(let i=0;i<mesh.indices.length;i+=3){
   const ia=mesh.indices[i]*3,ib=mesh.indices[i+1]*3,ic=mesh.indices[i+2]*3;
   const a=[mesh.positionsM[ia],mesh.positionsM[ia+1],mesh.positionsM[ia+2]],b=[mesh.positionsM[ib],mesh.positionsM[ib+1],mesh.positionsM[ib+2]],d=[mesh.positionsM[ic],mesh.positionsM[ic+1],mesh.positionsM[ic+2]];
   const ab=b.map((value,j)=>value-a[j]),ac=d.map((value,j)=>value-a[j]);
   const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
   assert.ok(cross[0]*(a[0]+b[0]+d[0])+cross[1]*(a[1]+b[1]+d[1])+cross[2]*(a[2]+b[2]+d[2])>0);
  }
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
 assert.ok(tile.height.some(value=>Math.abs(value)>1),'rocky relief is stored in metres, not unitless fractions');
 for(let i=0;i<tile.normal.length;i+=3){
  const nx=tile.normal[i]/255*2-1,ny=tile.normal[i+1]/255*2-1,nz=tile.normal[i+2]/255*2-1;
  const length=Math.hypot(nx,ny,nz);
  assert.ok(Number.isFinite(length)&&length>.97&&length<1.03);
 }
});

test('one subscriber abort does not cancel another subscriber to the same worker request',async()=>{
 class FakeWorker{
  onmessage:((event:MessageEvent)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  postMessage(message:{id:number;request:SurfaceTileRequest}){
   setTimeout(()=>{
    try{this.onmessage?.({data:{id:message.id,tile:generateSurfaceTile(message.request)}} as MessageEvent);}
    catch(error){this.onmessage?.({data:{id:message.id,error:String(error)}} as MessageEvent);}
   },0);
  }
  terminate(){}
 }
 const pool=new SurfaceTileWorkerPool({concurrency:1,workerFactory:()=>new FakeWorker() as unknown as Worker});
 const first=new AbortController(),second=new AbortController(),input=request({resolution:8});
 const a=pool.request(input,1,first.signal),b=pool.request(input,5,second.signal);
 first.abort();
 await assert.rejects(a,{name:'AbortError'});
 const result=await b;
 assert.equal(result.key,surfaceTileKey(input));
 pool.dispose();
});

test('atmospheric giant tiles keep solid height at exactly zero metres',()=>{
 const gas=generateSurfaceTile(request({resolution:8,profile:{...profile,kind:'gas-giant'}}));
 assert.ok(gas.height.every(value=>value===0));
});
