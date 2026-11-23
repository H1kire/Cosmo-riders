import { generateSurfaceCubeMaps,type SurfaceCubeMaps,type SurfaceGenerationProfile } from './surface-generator.ts';
interface Entry{maps:SurfaceCubeMaps;bytes:number;used:number;}
/** Small LRU cache; callers request only the LOD currently needed for visible bodies. */
export class SurfaceMapCache{
 private entries=new Map<string,Entry>();private clock=0;private bytes=0;
 constructor(readonly maxBytes=48*1024*1024){if(!Number.isFinite(maxBytes)||maxBytes<1)throw new RangeError('maxBytes must be positive.');}
 async get(profile:SurfaceGenerationProfile,resolution:number):Promise<SurfaceCubeMaps>{
  const key=profile.seed+':'+resolution,hit=this.entries.get(key);if(hit){hit.used=++this.clock;return hit.maps;}
  const maps=await generateSurfaceCubeMaps(profile,resolution,()=>new Promise(resolve=>setTimeout(resolve,0)));
  const bytes=maps.albedo.byteLength+maps.heightRoughness.byteLength+maps.normal.byteLength;
  while(this.bytes+bytes>this.maxBytes&&this.entries.size){let oldestKey:string|undefined,oldest=Infinity;for(const [candidate,entry]of this.entries)if(entry.used<oldest){oldest=entry.used;oldestKey=candidate;}if(oldestKey===undefined)break;this.bytes-=this.entries.get(oldestKey)!.bytes;this.entries.delete(oldestKey);}
  if(bytes<=this.maxBytes){this.entries.set(key,{maps,bytes,used:++this.clock});this.bytes+=bytes;}
  return maps;
 }
 clear(){this.entries.clear();this.bytes=0;}
 get memoryBytes(){return this.bytes;}
 get size(){return this.entries.size;}
}
