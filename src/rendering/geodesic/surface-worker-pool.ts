import { surfaceTileKey, type SurfaceTileData, type SurfaceTileRequest } from './surface-tile.ts';
import type { GeoTile } from './icosphere.ts';
import type { GeodesicTileMesh } from './tile-mesh.ts';
type WorkerValue=SurfaceTileData|GeodesicTileMesh;
type TaskPayload={kind:'tile';request:SurfaceTileRequest}|{kind:'mesh';tile:GeoTile;resolution:number;radiusM:number};
interface Subscriber {
 resolve:(value:WorkerValue)=>void;
 reject:(error:Error)=>void;
 signal?:AbortSignal;
 abort?:()=>void;
}
interface WorkerSlot { worker:Worker; task:Task|null; }
interface Task {
 id:number; key:string; payload:TaskPayload; priority:number; order:number;
 subscribers:Set<Subscriber>; cancelled:boolean;
}
type WorkerReply={id:number;tile?:SurfaceTileData;mesh?:GeodesicTileMesh;error?:string};

/** Обмежений пул воркерів; головний потік ніколи не виконує генерацію тайлів. */
export class SurfaceTileWorkerPool {
 private slots:WorkerSlot[]=[];
 private queue:Task[]=[];
 private pending=new Map<string,Task>();
 private ids=new Map<number,Task>();
 private sequence=0;
 private disposed=false;
 readonly concurrency:number;
 constructor(options:{concurrency?:number;workerFactory?:()=>Worker}={}){
  const cores=typeof navigator!=='undefined'&&Number.isFinite(navigator.hardwareConcurrency)?navigator.hardwareConcurrency:4;
  this.concurrency=Math.max(1,Math.min(4,options.concurrency??Math.max(1,Math.min(3,cores-2))));
  this.workerFactory=options.workerFactory??(()=>new Worker(new URL('./surface-tile-worker.ts',import.meta.url),{type:'module'}));
  this.start();
 }
 private readonly workerFactory:()=>Worker;
 private start():void{
  if(typeof Worker==='undefined'&&!this.workerFactory)return;
  for(let i=0;i<this.concurrency;i++)this.spawn();
 }
 private spawn():void{
  if(this.disposed)return;
  try{
   const worker=this.workerFactory(),slot:WorkerSlot={worker,task:null};
   this.startupError=null;
   worker.onmessage=(event:MessageEvent<WorkerReply>)=>this.finish(slot,event.data);
   worker.onerror=event=>{
    event.preventDefault?.();
    const task=slot.task;
    if(task){
     this.ids.delete(task.id);
     if(this.pending.get(task.key)===task)this.pending.delete(task.key);
     this.rejectSubscribers(task,new Error('Surface worker failed: '+(event.message||'unknown error')));
    }
    slot.task=null;worker.terminate();this.slots=this.slots.filter(item=>item!==slot);this.spawn();this.pump();
   };
   this.slots.push(slot);
  }catch(error){
   this.startupError=error instanceof Error?error:new Error(String(error));
   if(this.slots.length===0)this.rejectQueuedWithoutWorkers();
  }
 }
 private startupError:Error|null=null;
 private rejectQueuedWithoutWorkers():void{
  if(this.slots.length>0)return;
  const error=this.startupError??new Error('No surface workers are available.');
  for(const task of this.queue.splice(0)){
   if(this.pending.get(task.key)===task)this.pending.delete(task.key);
   this.rejectSubscribers(task,error);
  }
 }
 private rejectSubscribers(task:Task,error:Error):void{
  for(const subscriber of task.subscribers){
   subscriber.signal?.removeEventListener('abort',subscriber.abort!);
   subscriber.reject(error);
  }
  task.subscribers.clear();
 }
 private resolveSubscribers(task:Task,value:WorkerValue):void{
  for(const subscriber of task.subscribers){
   subscriber.signal?.removeEventListener('abort',subscriber.abort!);
   subscriber.resolve(value);
  }
  task.subscribers.clear();
 }
 private finish(slot:WorkerSlot,reply:WorkerReply):void{
  const task=this.ids.get(reply.id);if(!task||slot.task!==task)return;
  this.ids.delete(reply.id);slot.task=null;
  if(this.pending.get(task.key)===task)this.pending.delete(task.key);
  if(!task.cancelled){
   if(task.subscribers.size===0)task.cancelled=true;
   else if(reply.tile||reply.mesh)this.resolveSubscribers(task,(reply.tile??reply.mesh)!);
   else this.rejectSubscribers(task,new Error(reply.error??'Surface tile worker returned no data.'));
  }
  this.pump();
 }
 private pump():void{
  if(this.disposed)return;
  this.queue.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  for(const slot of this.slots){
   if(slot.task)continue;
   let task:Task|undefined;
   while(this.queue.length&&!task){
    const candidate=this.queue.shift()!;
    if(!candidate.cancelled&&candidate.subscribers.size>0)task=candidate;
    else if(this.pending.get(candidate.key)===candidate)this.pending.delete(candidate.key);
   }
   if(!task)continue;
   slot.task=task;this.ids.set(task.id,task);
   try{slot.worker.postMessage({id:task.id,...task.payload});}
   catch(error){
    slot.task=null;this.ids.delete(task.id);
    if(this.pending.get(task.key)===task)this.pending.delete(task.key);
    this.rejectSubscribers(task,error instanceof Error?error:new Error(String(error)));
   }
  }
 }
 private subscribe(task:Task,signal?:AbortSignal):Promise<SurfaceTileData>{
  if(signal?.aborted)return Promise.reject(new DOMException('Surface request aborted.','AbortError'));
  return new Promise<WorkerValue>((resolve,reject)=>{
   const subscriber:Subscriber={resolve,reject,signal};
   if(signal){
    subscriber.abort=()=>{
     task.subscribers.delete(subscriber);
     reject(new DOMException('Surface request aborted.','AbortError'));
     if(task.subscribers.size===0){
      task.cancelled=true;
      if(this.pending.get(task.key)===task)this.pending.delete(task.key);
      const index=this.queue.indexOf(task);
      if(index>=0)this.queue.splice(index,1);
     }
    };
    signal.addEventListener('abort',subscriber.abort,{once:true});
   }
   task.subscribers.add(subscriber);
  });
 }
 request(request:SurfaceTileRequest,priority=0,signal?:AbortSignal):Promise<SurfaceTileData>{
  if(this.disposed)return Promise.reject(new Error('Surface worker pool is disposed.'));
  if(signal?.aborted)return Promise.reject(new DOMException('Surface request aborted.','AbortError'));
  const key=surfaceTileKey(request),existing=this.pending.get(key);
  if(existing){
   existing.priority=Math.max(existing.priority,priority);
   this.pump();
   return this.subscribe(existing,signal);
  }
  if(this.slots.length===0)return Promise.reject(this.startupError??new Error('No surface workers are available.'));
  const task:Task={id:++this.sequence,key,payload:{kind:'tile',request},priority,order:this.sequence,subscribers:new Set(),cancelled:false};
  const promise=this.subscribe(task,signal) as Promise<SurfaceTileData>;
  this.pending.set(key,task);this.queue.push(task);this.pump();return promise;
 }
 requestMesh(tile:GeoTile,resolution:number,radiusM:number,priority=0):Promise<GeodesicTileMesh>{
  if(this.disposed)return Promise.reject(new Error('Surface worker pool is disposed.'));
  const key='mesh:'+tile.id.key+':'+resolution+':'+radiusM,existing=this.pending.get(key);
  if(existing){existing.priority=Math.max(existing.priority,priority);this.pump();return this.subscribe(existing) as Promise<GeodesicTileMesh>;}
  if(this.slots.length===0)return Promise.reject(this.startupError??new Error('No surface workers are available.'));
  const task:Task={id:++this.sequence,key,payload:{kind:'mesh',tile,resolution,radiusM},priority,order:this.sequence,subscribers:new Set(),cancelled:false};
  const promise=this.subscribe(task) as Promise<GeodesicTileMesh>;
  this.pending.set(key,task);this.queue.push(task);this.pump();return promise;
 }
 reprioritize(key:string,priority:number):void{
  const task=this.pending.get(key);
  if(task){task.priority=Math.max(task.priority,priority);this.pump();}
 }
 dispose():void{
  if(this.disposed)return;this.disposed=true;
  const error=new Error('Surface worker pool disposed.');
  for(const task of this.pending.values()){task.cancelled=true;this.rejectSubscribers(task,error);}
  for(const slot of this.slots)slot.worker.terminate();
  this.queue=[];this.slots=[];this.ids.clear();this.pending.clear();
 }
 get queuedCount():number{return this.queue.length;}
 get activeCount():number{return this.slots.filter(slot=>slot.task!==null).length;}
 get pendingCount():number{return this.pending.size;}
 get workerCount():number{return this.slots.length;}
}
