import { generateSurfaceTile, type SurfaceTileRequest } from './surface-tile.ts';
const scope=self as unknown as {onmessage:((event:MessageEvent<{id:number;request:SurfaceTileRequest}>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
 const {id,request}=event.data;
 try{
  const tile=generateSurfaceTile(request);
  scope.postMessage({id,tile},[tile.albedo.buffer,tile.normal.buffer,tile.height.buffer,tile.roughness.buffer,tile.materialId.buffer]);
 }catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
