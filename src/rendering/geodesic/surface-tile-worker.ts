import { generateSurfaceTile, type SurfaceTileRequest } from './surface-tile.ts';
import { buildGeodesicTileMesh, type GeodesicTileMesh } from './tile-mesh.ts';
import type { GeoTile } from './icosphere.ts';
type WorkerTask={id:number;kind:'tile';request:SurfaceTileRequest}|{id:number;kind:'mesh';tile:GeoTile;resolution:number;radiusM:number};
const scope=self as unknown as {onmessage:((event:MessageEvent<WorkerTask>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
 const task=event.data;
 try{
  if(task.kind==='mesh'){
   const mesh:GeodesicTileMesh=buildGeodesicTileMesh(task.tile,task.resolution,task.radiusM);
   scope.postMessage({id:task.id,mesh},[mesh.directions.buffer,mesh.positionsM.buffer,mesh.normals.buffer,mesh.textureCoordinates.buffer,mesh.indices.buffer]);
   return;
  }
  const tile=generateSurfaceTile(task.request);
  scope.postMessage({id:task.id,tile},[tile.albedo.buffer,tile.normal.buffer,tile.height.buffer,tile.roughness.buffer,tile.materialId.buffer]);
 }catch(error){scope.postMessage({id:task.id,error:error instanceof Error?error.message:String(error)});}
};
