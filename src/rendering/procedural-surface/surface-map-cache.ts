import { generateSurfaceCubeMaps, surfaceProfileKey, type SurfaceCubeMaps, type SurfaceGenerationProfile } from './surface-generator.ts';
interface Entry { maps:SurfaceCubeMaps; bytes:number; used:number; }
interface Task { key:string; profile:SurfaceGenerationProfile; resolution:number; priority:number; order:number; resolve:(maps:SurfaceCubeMaps)=>void; reject:(error:Error)=>void; }
type WorkerResult={id:number;maps?:SurfaceCubeMaps;generationMs?:number;error?:string};
/** Обмежений LRU-кеш із одним Worker та пріоритетною чергою генерації. */
export class SurfaceMapCache {
 private entries=new Map<string,Entry>();
 private pending=new Map<string,Promise<SurfaceCubeMaps>>();
 private queue:Task[]=[];
 private activeTask:Task|null=null;
 private requests=new Map<number,Task>();
 private clock=0; private bytes=0; private nextId=1;
 private worker:Worker|null=null; private workerFailed=false; private disposed=false;
 constructor(readonly maxBytes=48*1024*1024) {
  if(!Number.isFinite(maxBytes)||maxBytes<1)throw new RangeError('maxBytes must be positive.');
 }
 private ensureWorker():Worker|null {
  if(this.worker||this.workerFailed||typeof Worker==='undefined')return this.worker;
  try{
   const worker=new Worker(new URL('./surface-worker.ts',import.meta.url),{type:'module'});
   worker.onmessage=(event:MessageEvent<WorkerResult>)=>{
    const task=this.requests.get(event.data.id);if(!task)return;
    this.requests.delete(event.data.id);
    if(event.data.maps)this.complete(task,event.data.maps);
    else this.fail(task,new Error(event.data.error??'Surface worker failed.'));
   };
   worker.onerror=()=>{
    this.workerFailed=true;this.worker?.terminate();this.worker=null;
    const active=this.activeTask;
    if(active)this.fail(active,new Error('Surface worker crashed.'));
   };
   this.worker=worker;return worker;
  }catch{this.workerFailed=true;return null;}
 }
 private remember(task:Task,maps:SurfaceCubeMaps):void {
  const size=maps.albedo.byteLength+maps.height.byteLength+maps.roughness.byteLength+maps.normal.byteLength;
  while(this.bytes+size>this.maxBytes&&this.entries.size){
   let oldestKey:string|undefined,oldest=Infinity;
   for(const [key,value] of this.entries)if(value.used<oldest){oldest=value.used;oldestKey=key;}
   if(oldestKey===undefined)break;
   this.bytes-=this.entries.get(oldestKey)!.bytes;this.entries.delete(oldestKey);
  }
  if(size<=this.maxBytes){this.entries.set(task.key,{maps,bytes:size,used:++this.clock});this.bytes+=size;}
 }
 private complete(task:Task,maps:SurfaceCubeMaps):void {
  if(this.disposed)return;
  this.remember(task,maps);this.pending.delete(task.key);this.activeTask=null;
  task.resolve(maps);this.pump();
 }
 private fail(task:Task,error:Error):void {
  this.pending.delete(task.key);this.activeTask=null;task.reject(error);this.pump();
 }
 private pump():void {
  if(this.disposed||this.activeTask||!this.queue.length)return;
  this.queue.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  const task=this.queue.shift()!;this.activeTask=task;
  const worker=this.ensureWorker();
  if(worker){
   const id=this.nextId++;this.requests.set(id,task);
   try{worker.postMessage({id,profile:task.profile,resolution:task.resolution});}
   catch(error){this.requests.delete(id);this.workerFailed=true;worker.terminate();this.worker=null;this.fail(task,error instanceof Error?error:new Error(String(error)));}
   return;
  }
  generateSurfaceCubeMaps(task.profile,task.resolution,()=>new Promise<void>(done=>setTimeout(done,0)))
   .then(maps=>this.complete(task,maps),error=>this.fail(task,error instanceof Error?error:new Error(String(error))));
 }
 get(profile:SurfaceGenerationProfile,resolution:number,priority=0):Promise<SurfaceCubeMaps>{
  const key=surfaceProfileKey(profile)+':'+resolution,hit=this.entries.get(key);
  if(hit){hit.used=++this.clock;return Promise.resolve(hit.maps);}
  const existing=this.pending.get(key);if(existing){
   const queued=this.queue.find(task=>task.key===key);
   if(queued)queued.priority=Math.max(queued.priority,priority);
   return existing;
  }
  if(this.disposed)return Promise.reject(new Error('Surface cache is disposed.'));
  const promise=new Promise<SurfaceCubeMaps>((resolve,reject)=>{
   this.queue.push({key,profile,resolution,priority,order:++this.clock,resolve,reject});
  });
  this.pending.set(key,promise);this.pump();return promise;
 }
 has(profile:SurfaceGenerationProfile,resolution:number):boolean{return this.entries.has(surfaceProfileKey(profile)+':'+resolution);}
 clear():void{this.entries.clear();this.bytes=0;}
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.worker?.terminate();this.worker=null;
  const error=new Error('Surface cache disposed.');
  for(const task of this.queue)task.reject(error);
  this.queue.length=0;
  if(this.activeTask)this.activeTask.reject(error);
  this.activeTask=null;this.requests.clear();this.pending.clear();this.clear();
 }
 get workerEnabled():boolean{return this.worker!==null;}
 get memoryBytes():number{return this.bytes;}
 get size():number{return this.entries.size;}
 get pendingCount():number{return this.pending.size;}
 get queuedCount():number{return this.queue.length;}
}
