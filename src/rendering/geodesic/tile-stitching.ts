/** Cached conforming triangulations for the three possible coarse-neighbor edges. */
export type StitchEdgeMask = number;
/** Edge bits: AB = 1 (row 0), BC = 2 (row + column = resolution), CA = 4 (column 0). */
const indexCache=new Map<string,Uint32Array>();
type GridPoint=readonly [row:number,column:number];
type Triangle=readonly [GridPoint,GridPoint,GridPoint];

export function triangleGridVertexIndex(resolution:number,row:number,column:number):number{
 if(!Number.isInteger(resolution)||resolution<2||resolution%2!==0||resolution>64)throw new RangeError('Stitching resolution must be an even integer in [2, 64].');
 if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||row>resolution||column<0||column>resolution-row)throw new RangeError('Triangle grid coordinate is outside the mesh.');
 return row*(resolution+1)-row*(row-1)/2+column;
}
function orient(a:GridPoint,b:GridPoint,p:GridPoint):number{
 return (b[1]-a[1])*(p[0]-a[0])-(b[0]-a[0])*(p[1]-a[1]);
}
function pointKey(point:GridPoint):string{return point[0]+':'+point[1];}
function edgeKey(a:GridPoint,b:GridPoint):string{
 const ka=pointKey(a),kb=pointKey(b);return ka<kb?ka+'|'+kb:kb+'|'+ka;
}
function buildRegularGridTemplate(resolution:number):Uint32Array{
 const indices=new Uint32Array(resolution*resolution*3);let offset=0;
 for(let row=0;row<resolution;row++)for(let column=0;column<resolution-row;column++){
  const a=triangleGridVertexIndex(resolution,row,column),b=triangleGridVertexIndex(resolution,row,column+1),c=triangleGridVertexIndex(resolution,row+1,column);
  indices[offset++]=a;indices[offset++]=b;indices[offset++]=c;
  if(row+column<resolution-1){const d=triangleGridVertexIndex(resolution,row+1,column+1);indices[offset++]=b;indices[offset++]=d;indices[offset++]=c;}
 }
 if(offset!==indices.length)throw new Error('Regular triangular grid index count mismatch.');
 return indices;
}
function isRemovedBoundaryPoint(row:number,column:number,resolution:number,mask:StitchEdgeMask):boolean{
 return ((mask&1)!==0&&row===0&&column%2===1)||
  ((mask&2)!==0&&row+column===resolution&&row%2===1)||
  ((mask&4)!==0&&column===0&&row%2===1);
}

/**
 * Incrementally triangulates the triangular lattice after omitting odd samples
 * on coarse-neighbor edges. Every retained lattice point is inserted into the
 * current triangulation; points on an existing edge split both incident faces.
 */
export function buildStitchIndexTemplate(resolution:number,mask:StitchEdgeMask):Uint32Array{
 if(!Number.isInteger(resolution)||resolution<2||resolution%2!==0||resolution>64)throw new RangeError('Stitching resolution must be an even integer in [2, 64].');
 if(!Number.isInteger(mask)||mask<0||mask>7)throw new RangeError('Stitch edge mask must be in [0, 7].');
 const cacheKey=resolution+':'+mask,cached=indexCache.get(cacheKey);if(cached)return cached;
 if(mask===0){const regular=buildRegularGridTemplate(resolution);indexCache.set(cacheKey,regular);return regular;}
 const a:GridPoint=[0,0],b:GridPoint=[0,resolution],c:GridPoint=[resolution,0];
 let triangles:Triangle[]=[[a,b,c]];
 for(let row=0;row<=resolution;row++){
  for(let column=0;column<=resolution-row;column++){
   if(isRemovedBoundaryPoint(row,column,resolution,mask))continue;
   const point:GridPoint=[row,column];
   if(pointKey(point)==='0:0'||pointKey(point)==='0:'+resolution||pointKey(point)===resolution+':0')continue;
   const containing:Triangle[]=[];
   for(const triangle of triangles){
    const o0=orient(triangle[0],triangle[1],point),o1=orient(triangle[1],triangle[2],point),o2=orient(triangle[2],triangle[0],point);
    if(o0>=0&&o1>=0&&o2>=0)containing.push(triangle);
   }
   if(containing.length===0)throw new Error('Stitch triangulation could not locate an interior grid point.');
   const boundary=new Map<string,{a:GridPoint;b:GridPoint;count:number}>();
   for(const triangle of containing){
    for(let edge=0;edge<3;edge++){
     const from=triangle[edge],to=triangle[(edge+1)%3],key=edgeKey(from,to),existing=boundary.get(key);
     if(existing)existing.count++;else boundary.set(key,{a:from,b:to,count:1});
    }
   }
   const removed=new Set(containing);
   triangles=triangles.filter(triangle=>!removed.has(triangle));
   for(const edge of boundary.values()){
    if(edge.count!==1)continue;
    const winding=orient(edge.a,edge.b,point);
    if(winding>0)triangles.push([edge.a,edge.b,point]);
    else if(winding<0)triangles.push([edge.b,edge.a,point]);
   }
  }
 }
 const indices:number[]=[];
 for(const triangle of triangles){
  const [p0,p1,p2]=triangle;
  if(orient(p0,p1,p2)<=0)throw new Error('Stitch triangulation produced an invalid triangle winding.');
  indices.push(triangleGridVertexIndex(resolution,...p0),triangleGridVertexIndex(resolution,...p1),triangleGridVertexIndex(resolution,...p2));
 }
 const result=Uint32Array.from(indices);indexCache.set(cacheKey,result);return result;
}
export function clearStitchIndexCache():void{indexCache.clear();}
export function stitchIndexCacheSize():number{return indexCache.size;}
