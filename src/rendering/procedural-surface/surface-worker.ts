import { generateSurfaceCubeMaps, type SurfaceGenerationProfile } from './surface-generator.ts';
const scope=self as unknown as {onmessage:((event:MessageEvent<{id:number;profile:SurfaceGenerationProfile;resolution:number}>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
scope.onmessage=async event=>{
 const {id,profile,resolution}=event.data;
 try{
  const maps=await generateSurfaceCubeMaps(profile,resolution);
  scope.postMessage({id,maps},[maps.albedo.buffer,maps.height.buffer,maps.roughness.buffer,maps.normal.buffer]);
 }catch(error){scope.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
