import { ICOSAHEDRON_ADJACENCY, type GeoTile, type Vec3 } from './icosphere.ts';

export interface TileNeighbor {
 readonly tile:GeoTile;
 readonly edge:0|1|2;
 readonly neighbor:GeoTile;
 readonly neighborEdge:0|1|2;
}
export interface TileNeighborMap {
 readonly links:readonly TileNeighbor[];
 readonly byTile:ReadonlyMap<string,readonly TileNeighbor[]>;
 readonly comparisons:number;
}
const TOLERANCE=1e-8;
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(v:Vec3)=>Math.hypot(v[0],v[1],v[2]);
const angle=(a:Vec3,b:Vec3)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b))));
const edges=(tile:GeoTile):readonly (readonly [Vec3,Vec3])[]=>[[tile.triangle.a,tile.triangle.b],[tile.triangle.b,tile.triangle.c],[tile.triangle.c,tile.triangle.a]];
function onMinorArc(point:Vec3,a:Vec3,b:Vec3):boolean{
 const ab=angle(a,b),sum=angle(a,point)+angle(point,b);
 return Math.abs(sum-ab)<=TOLERANCE;
}
function sameArc(a:readonly [Vec3,Vec3],b:readonly [Vec3,Vec3]):boolean{
 const na=cross(a[0],a[1]),nb=cross(b[0],b[1]),la=length(na),lb=length(nb);
 if(la<TOLERANCE||lb<TOLERANCE)return false;
 if(1-Math.abs(dot(na,nb)/(la*lb))>TOLERANCE)return false;
 let contained=0;
 for(const point of a)if(onMinorArc(point,b[0],b[1]))contained++;
 for(const point of b)if(onMinorArc(point,a[0],a[1]))contained++;
 return contained>=2&&angle(a[0],a[1])+angle(b[0],b[1])>TOLERANCE;
}

/** Finds exact shared great-circle edge intervals, including a fine edge contained in a coarse edge. */
export function findTileNeighbors(tiles:readonly GeoTile[]):TileNeighborMap{
 const byFace=new Map<number,GeoTile[]>();
 for(const tile of tiles){const list=byFace.get(tile.id.face)??[];list.push(tile);byFace.set(tile.id.face,list);}
 const links:TileNeighbor[]=[],byTile=new Map<string,TileNeighbor[]>(),seen=new Set<string>();
 let comparisons=0;
 const compareFaces=(faceA:number,faceB:number)=>{
  const a=byFace.get(faceA)??[],b=byFace.get(faceB)??[];
  for(const ta of a)for(const tb of b){
   if(ta.id.key===tb.id.key||(faceA===faceB&&ta.id.key>tb.id.key))continue;
   const ea=edges(ta),eb=edges(tb);
   for(let ia=0;ia<3;ia++)for(let ib=0;ib<3;ib++){
    comparisons++;
    if(!sameArc(ea[ia],eb[ib]))continue;
    const pair=ta.id.key<tb.id.key?ta.id.key+'|'+tb.id.key:tb.id.key+'|'+ta.id.key;
    const identity=pair+':'+ia+':'+ib;
    if(seen.has(identity))continue;seen.add(identity);
    const forward:TileNeighbor={tile:ta,edge:ia as 0|1|2,neighbor:tb,neighborEdge:ib as 0|1|2};
    const reverse:TileNeighbor={tile:tb,edge:ib as 0|1|2,neighbor:ta,neighborEdge:ia as 0|1|2};
    links.push(forward,reverse);
    const listA=byTile.get(ta.id.key)??[];listA.push(forward);byTile.set(ta.id.key,listA);
    const listB=byTile.get(tb.id.key)??[];listB.push(reverse);byTile.set(tb.id.key,listB);
   }
  }
 };
 for(const face of byFace.keys()){
  compareFaces(face,face);
  for(const edge of ICOSAHEDRON_ADJACENCY[face].edges)if(face<edge.face)compareFaces(face,edge.face);
 }
 return{links:Object.freeze(links),byTile,comparisons};
}
