import { generateSurfaceCubeMaps, surfaceProfileKey, type SurfaceCubeMaps, type SurfaceGenerationProfile } from './surface-generator.ts';
interface Entry { maps:SurfaceCubeMaps; bytes:number; used:number; }
interface Pending { resolve:(maps:SurfaceCubeMaps)=>void; reject:(error:Error)=>void; }
type WorkerResult={id:number;maps?:SurfaceCubeMaps;error?:string};
/** Bounded LRU cache backed by one dedicated Worker. Only one CPU generation job runs at a time. */
export class SurfaceMapCache {
 private entries=new Map<string,Entry>(); private pending=new Map<string,Promise<SurfaceCubeMaps>>();
 private requests=new Map<number,Pending>(); private clock=0; private bytes=0; private nextId=1;
 private worker:Worker|null=null; private workerFailed=false;
 constructor(readonly maxBytes=48*1024*1024) { if(!Number.isFinite(maxBytes)||maxBytes<1)throw new RangeError('maxBytes must be positive.'); }
 private ensureWorker():Worker|null {
  if(this.worker||this.workerFailed||typeof Worker==='undefined')return this.worker;
  try {
   const worker=new Worker(new URL('./surface-worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=(event:MessageEvent<WorkerResult>)=>{
    const request=this.requests.get(event.data.id);if(!request)return;
    this.requests.delete(event.data.id);
    if(event.data.maps){this.store(request,event.data.maps);request.resolve(event.data.maps);}
    else request.reject(new Error(event.data.error??'Surface worker failed.'));
   };
   worker.onerror=()=>{
    this.workerFailed=true;this.worker?.terminate();this.worker=null;
    for(const request of this.requests.values())request.reject(new Error('Surface worker crashed.'));
    this.requests.clear();
   };
   this.worker=worker;return worker;
  } catch { this.workerFailed=true;return null; }
 }
 async get(profile:SurfaceGenerationProfile,resolution:number):Promise<SurfaceCubeMaps> {
  const key=surfaceProfileKey(profile)+':'+resolution,hit=this.entries.get(key);
  if(hit){hit.used=++this.clock;return hit.maps;}
  const existing=this.pending.get(key);if(existing)return existing;
  const promise=new Promise<SurfaceCubeMaps>((resolve,reject)=>{
   const request:Pending={resolve:maps=>{this.pending.delete(key);const bytes=maps.albedo.byteLength+maps.height.byteLength+maps.roughness.byteLength+maps.normal.byteLength;while(this.bytes+bytes>this.maxBytes&&this.entries.size){let oldestKey:string|undefined,oldest=Infinity;for(const [candidate,entry]of this.entries)if(entry.used<oldest){oldest=entry.used;oldestKey=candidate;}if(oldestKey===undefined)break;this.bytes-=this.entries.get(oldestKey)!.bytes;this.entries.delete(oldestKey);}if(bytes<=this.maxBytes){this.entries.set(key,{maps,bytes,used:++this.clock});this.bytes+=bytes;}resolve(maps);},reject:error=>{this.pending.delete(key);reject(error);}};
   const worker=this.ensureWorker();
   if(worker){const id=this.nextId++;this.requests.set(id,request);worker.postMessage({id,profile,resolution});}
   else generateSurfaceCubeMaps(profile,resolution,()=>new Promise(done=>setTimeout(done,0))).then(request.resolve,request.reject);
  });
  this.pending.set(key,promise);return promise;
 }
 clear():void {this.entries.clear();this.bytes=0;}
 dispose():void {this.worker?.terminate();this.worker=null;this.workerFailed=true;for(const request of this.requests.values())request.reject(new Error('Surface cache disposed.'));this.requests.clear();this.pending.clear();this.clear();}
 get memoryBytes():number{return this.bytes;}
 get size():number{return this.entries.size;}
 get pendingCount():number{return this.pending.size;}
}
