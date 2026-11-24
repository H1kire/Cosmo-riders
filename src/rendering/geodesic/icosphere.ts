/** Геодезична ієрархія трикутних ділянок без глобальних UV-координат. */
export type Vec3 = readonly [number, number, number];
export interface GeoTriangle { readonly a: Vec3; readonly b: Vec3; readonly c: Vec3; }
export interface GeoTileId { readonly face: number; readonly path: string; readonly level: number; readonly key: string; }
export interface GeoTile { readonly id: GeoTileId; readonly triangle: GeoTriangle; }

const PHI=(1+Math.sqrt(5))/2;
const normalize=(v:Vec3):Vec3=>{const m=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/m,v[1]/m,v[2]/m];};
const midpoint=(a:Vec3,b:Vec3):Vec3=>normalize([(a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5]);

const V:Vec3[]=[
 [-1,PHI,0],[1,PHI,0],[-1,-PHI,0],[1,-PHI,0],
 [0,-1,PHI],[0,1,PHI],[0,-1,-PHI],[0,1,-PHI],
 [PHI,0,-1],[PHI,0,1],[-PHI,0,-1],[-PHI,0,1]
].map(value=>normalize(value as Vec3));

const F:readonly (readonly [number,number,number])[]=[
 [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
 [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
 [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
 [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
];
export const ICOSAHEDRON_FACES:readonly GeoTriangle[]=Object.freeze(F.map(([a,b,c])=>Object.freeze({a:V[a],b:V[b],c:V[c]})));

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
/** Трикутна регулярна сітка; вершини межі задаються спільними сферичними напрямками. */
export function buildTileDirections(tile:GeoTile,resolution:number,gutter=2):Float32Array{
 if(!Number.isInteger(resolution)||resolution<2||resolution>1024)throw new RangeError('Tile resolution must be an integer in [2, 1024].');
 if(!Number.isInteger(gutter)||gutter<0||gutter>16)throw new RangeError('Invalid tile gutter.');
 const n=resolution+2*gutter,out=new Float32Array((n+1)*(n+2)/2*3);let offset=0;
 for(let row=-gutter;row<=resolution+gutter;row++){
  for(let col=-gutter;col<=resolution+gutter-row;col++){
   const u=col/resolution,v=row/resolution,d=barycentricDirection(tile.triangle,u,v);
   out[offset++]=d[0];out[offset++]=d[1];out[offset++]=d[2];
  }
 }
 return out;
}
