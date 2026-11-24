export type StitchEdgeMask = number;
/** Edge bits: AB = 1, BC = 2, CA = 4. */
const indexCache=new Map<string,Uint32Array>();

export function triangleGridVertexIndex(resolution:number,row:number,column:number):number{
 if(!Number.isInteger(resolution)||resolution<2||resolution%2!==0)throw new RangeError('Stitching resolution must be an even integer >= 2.');
 if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||row>resolution||column<0||column>resolution-row)throw new RangeError('Triangle grid coordinate is outside the mesh.');
 return row*(resolution+1)-row*(row-1)/2+column;
}

function remapBoundaryVertex(resolution:number,row:number,column:number,mask:StitchEdgeMask):readonly [number,number]{
 let r=row,c=column;
 // Odd boundary samples are collapsed onto the first interior row, so the coarse edge has no T-junction vertices.
 if((mask&1)!==0&&r===0&&c%2===1){r=1;}
 if((mask&2)!==0&&r+c===resolution&&r%2===1){c-=1;}
 if((mask&4)!==0&&c===0&&r%2===1){c=1;}
 return[r,c];
}

/** Builds a conforming triangular index buffer for all eight coarse-neighbor edge combinations. */
export function buildStitchIndexTemplate(resolution:number,mask:StitchEdgeMask):Uint32Array{
 if(!Number.isInteger(resolution)||resolution<2||resolution%2!==0)throw new RangeError('Stitching resolution must be an even integer >= 2.');
 if(!Number.isInteger(mask)||mask<0||mask>7)throw new RangeError('Stitch edge mask must be in [0, 7].');
 const cacheKey=resolution+':'+mask,cached=indexCache.get(cacheKey);if(cached)return cached;
 const indices:number[]=[];
 const append=(points:readonly (readonly [number,number])[])=>{
  let a=remapBoundaryVertex(resolution,points[0][0],points[0][1],mask);
  let b=remapBoundaryVertex(resolution,points[1][0],points[1][1],mask);
  let c=remapBoundaryVertex(resolution,points[2][0],points[2][1],mask);
  if((a[0]===b[0]&&a[1]===b[1])||(b[0]===c[0]&&b[1]===c[1])||(c[0]===a[0]&&c[1]===a[1]))return;
  const area=(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1]);
  if(area===0)return;
  if(area<0){const swap=b;b=c;c=swap;}
  indices.push(triangleGridVertexIndex(resolution,...a),triangleGridVertexIndex(resolution,...b),triangleGridVertexIndex(resolution,...c));
 };
 for(let row=0;row<resolution;row++){
  for(let column=0;column<resolution-row;column++){
   append([[row,column],[row,column+1],[row+1,column]]);
   if(column<resolution-row-1)append([[row,column+1],[row+1,column+1],[row+1,column]]);
  }
 }
 const result=Uint32Array.from(indices);indexCache.set(cacheKey,result);return result;
}

export function clearStitchIndexCache():void{indexCache.clear();}
export function stitchIndexCacheSize():number{return indexCache.size;}
