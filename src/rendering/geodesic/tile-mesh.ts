import { barycentricDirection, type GeoTile } from './icosphere.ts';
import { buildStitchIndexTemplate, type StitchEdgeMask } from './tile-stitching.ts';

export interface GeodesicTileMesh {
 readonly tileKey:string;
 readonly resolution:number;
 readonly radiusM:number;
 readonly directions:Float32Array;
 readonly positionsM:Float32Array;
 readonly indices:Uint32Array;
}

/** Builds the indexed spherical patch consumed by the future planet renderer. */
export function buildGeodesicTileMesh(tile:GeoTile,resolution:number,radiusM:number,coarseEdgeMask:StitchEdgeMask=0):GeodesicTileMesh{
 if(!Number.isInteger(resolution)||resolution<2||resolution%2!==0)throw new RangeError('Geodesic mesh resolution must be an even integer >= 2.');
 if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Geodesic mesh radius must be positive metres.');
 const vertexCount=(resolution+1)*(resolution+2)/2,directions=new Float32Array(vertexCount*3),positionsM=new Float32Array(vertexCount*3);
 let index=0;
 for(let row=0;row<=resolution;row++){
  for(let column=0;column<=resolution-row;column++){
   const direction=barycentricDirection(tile.triangle,column/resolution,row/resolution);
   directions.set(direction,index*3);
   positionsM[index*3]=direction[0]*radiusM;
   positionsM[index*3+1]=direction[1]*radiusM;
   positionsM[index*3+2]=direction[2]*radiusM;
   index++;
  }
 }
 if(index!==vertexCount)throw new Error('Geodesic mesh vertex count mismatch.');
 return{tileKey:tile.id.key,resolution,radiusM,directions,positionsM,indices:buildStitchIndexTemplate(resolution,coarseEdgeMask)};
}
