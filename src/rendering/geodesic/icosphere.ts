/** Геодезична ієрархія трикутних ділянок без глобальних UV-координат. */
export type Vec3 = readonly [number, number, number];
export interface GeoTriangle { readonly a: Vec3; readonly b: Vec3; readonly c: Vec3; }
export interface GeoTileId { readonly face: number; readonly path: string; readonly level: number; readonly key: string; }
export interface GeoTile { readonly id: GeoTileId; readonly triangle: GeoTriangle; }

const PHI=(1+Math.sqrt(5))/2;
const normalize=(v:Vec3):Vec3=>{const m=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);if(!Number.isFinite(m)||m===0)throw new RangeError('Cannot normalize a zero or non-finite direction.');return[v[0]/m,v[1]/m,v[2]/m];};
const midpoint=(a:Vec3,b:Vec3):Vec3=>normalize([(a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5]);

export const ICOSAHEDRON_VERTICES:readonly Vec3[]=Object.freeze([
 [-1,PHI,0],[1,PHI,0],[-1,-PHI,0],[1,-PHI,0],
 [0,-1,PHI],[0,1,PHI],[0,-1,-PHI],[0,1,-PHI],
 [PHI,0,-1],[PHI,0,1],[-PHI,0,-1],[-PHI,0,1]
].map(value=>Object.freeze(normalize(value as unknown as Vec3))));

export const ICOSAHEDRON_FACE_INDICES:readonly (readonly [number,number,number])[]=Object.freeze([
 [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
 [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
 [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
 [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
].map(face=>Object.freeze(face as unknown as readonly [number,number,number])));

export const ICOSAHEDRON_FACES:readonly GeoTriangle[]=Object.freeze(ICOSAHEDRON_FACE_INDICES.map(([a,b,c])=>Object.freeze({
 a:ICOSAHEDRON_VERTICES[a],b:ICOSAHEDRON_VERTICES[b],c:ICOSAHEDRON_VERTICES[c]
})));

export interface IcosahedronEdgeLink {
 readonly face:number;
 /** Local edge: 0 = AB, 1 = BC, 2 = CA. */
 readonly edge:0|1|2;
 /** True when both faces traverse the shared edge in opposite directions. */
 readonly reversed:boolean;
}
export interface IcosahedronFaceAdjacency {
 readonly face:number;
 readonly edges:readonly [IcosahedronEdgeLink,IcosahedronEdgeLink,IcosahedronEdgeLink];
}

/** Топологічне сусідство визначається індексами вихідних вершин, а не похибкою координат. */
export const ICOSAHEDRON_ADJACENCY:readonly IcosahedronFaceAdjacency[]=(()=>{
 const edgeOwners=new Map<string,{face:number;edge:0|1|2;from:number;to:number}[]>();
 for(let face=0;face<ICOSAHEDRON_FACE_INDICES.length;face++){
  const [a,b,c]=ICOSAHEDRON_FACE_INDICES[face],edges:[[number,number],[number,number],[number,number]]=[[a,b],[b,c],[c,a]];
  for(let edge=0;edge<3;edge++){
   const [from,to]=edges[edge],key=from<to?from+':'+to:to+':'+from;
   const owners=edgeOwners.get(key)??[];
   owners.push({face,edge:edge as 0|1|2,from,to});edgeOwners.set(key,owners);
  }
 }
 const adjacency:{face:number;edges:IcosahedronEdgeLink[]}[]=ICOSAHEDRON_FACE_INDICES.map((_,face)=>({face,edges:[]}));
 for(const owners of edgeOwners.values()){
  if(owners.length!==2)throw new Error('Every icosahedron edge must have exactly two incident faces.');
  const [a,b]=owners;
  adjacency[a.face].edges[a.edge]={face:b.face,edge:b.edge,reversed:a.from===b.to&&a.to===b.from};
  adjacency[b.face].edges[b.edge]={face:a.face,edge:a.edge,reversed:a.from===b.to&&a.to===b.from};
 }
 return Object.freeze(adjacency.map(item=>Object.freeze({face:item.face,edges:Object.freeze(item.edges) as unknown as IcosahedronFaceAdjacency['edges']})));
})();

export function normalizeDirection(v:Vec3):Vec3{return normalize(v);}
export function barycentricDirection(t:GeoTriangle,u:number,v:number):Vec3{
 const w=1-u-v;
 return normalize([t.a[0]*w+t.b[0]*u+t.c[0]*v,t.a[1]*w+t.b[1]*u+t.c[1]*v,t.a[2]*w+t.b[2]*u+t.c[2]*v]);
}
export function tileId(face:number,path=''):GeoTileId{
 if(!Number.isInteger(face)||face<0||face>=20)throw new RangeError('Geodesic face must be in [0, 19].');
 if(!/^[0-3]*$/.test(path))throw new TypeError('Tile path may contain only child digits 0..3.');
 return Object.freeze({face,path,level:path.length,key:face.toString(36)+':'+(path||'root')});
}
export function subdivideTriangle(t:GeoTriangle):readonly [GeoTriangle,GeoTriangle,GeoTriangle,GeoTriangle]{
 const ab=midpoint(t.a,t.b),bc=midpoint(t.b,t.c),ca=midpoint(t.c,t.a);
 return [
  {a:t.a,b:ab,c:ca},
  {a:ab,b:t.b,c:bc},
  {a:ca,b:bc,c:t.c},
  {a:ab,b:bc,c:ca}
 ];
}
export function resolveGeoTile(id:GeoTileId):GeoTile{
 if(id.level!==id.path.length||id.key!==tileId(id.face,id.path).key)throw new TypeError('Inconsistent geodesic tile identifier.');
 let triangle=ICOSAHEDRON_FACES[id.face];
 for(const digit of id.path)triangle=subdivideTriangle(triangle)[Number(digit)] as GeoTriangle;
 return {id,triangle};
}
export function childrenOf(tile:GeoTile):readonly GeoTile[]{
 return subdivideTriangle(tile.triangle).map((triangle,index)=>({id:tileId(tile.id.face,tile.id.path+index),triangle}));
}
export function baseGeoTiles():readonly GeoTile[]{
 return ICOSAHEDRON_FACES.map((triangle,face)=>({id:tileId(face),triangle}));
}

/** Кількість точок у фактичному розширеному трикутному обході з gutter. */
export function tileDirectionVertexCount(resolution:number,gutter=0):number{
 if(!Number.isInteger(resolution)||resolution<2||resolution>1024)throw new RangeError('Tile resolution must be an integer in [2, 1024].');
 if(!Number.isInteger(gutter)||gutter<0||gutter>16)throw new RangeError('Invalid tile gutter.');
 const span=resolution+2*gutter;
 // Rows: -g..resolution+g; each row contains (span - row + g + 1) columns.
 return (span+1)*(resolution/2+2*gutter+1);
}

/** Трикутна регулярна сітка; розширений gutter зберігає всі рядки та стовпці обходу. */
export function buildTileDirections(tile:GeoTile,resolution:number,gutter=2):Float32Array{
 const expected=tileDirectionVertexCount(resolution,gutter);
 const out=new Float32Array(expected*3);let offset=0;
 for(let row=-gutter;row<=resolution+gutter;row++){
  for(let col=-gutter;col<=resolution+gutter-row;col++){
   const u=col/resolution,v=row/resolution,d=barycentricDirection(tile.triangle,u,v);
   out[offset++]=d[0];out[offset++]=d[1];out[offset++]=d[2];
  }
 }
 if(offset!==out.length)throw new Error(`Geodesic grid wrote ${offset/3} vertices; expected ${expected}.`);
 return out;
}
