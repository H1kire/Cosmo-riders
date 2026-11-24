import { generateSurfaceCubeMaps, type SurfaceGenerationProfile } from './surface-generator.ts';
const scope=self as unknown as {onmessage:((event:MessageEvent<{id:number;profile:SurfaceGenerationProfile;resolution:number}>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
scope.onmessage=async event=>{
 const {id,profile,resolution}=event.data;
 try{
  const maps=await generateSurfaceCubeMaps(profile,resolution);
  scope.postMessage({id,maps,generationMs:maps.generationMs},[maps.albedo.buffer as ArrayBuffer,maps.height.buffer as ArrayBuffer,maps.roughness.buffer as ArrayBuffer,maps.normal.buffer as ArrayBuffer]);
 }catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
