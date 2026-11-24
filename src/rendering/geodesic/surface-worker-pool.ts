import { surfaceTileKey, type SurfaceTileData, type SurfaceTileRequest } from './surface-tile.ts';
import type { GeoTile } from './icosphere.ts';
import type { GeodesicTileMesh } from './tile-mesh.ts';
type WorkerValue=SurfaceTileData|GeodesicTileMesh;
type TaskKind='tile'|'mesh';
type FailureKind=TaskKind|'worker-startup'|'worker-runtime';
type TaskPayload={kind:'tile';request:SurfaceTileRequest}|{kind:'mesh';tile:GeoTile;resolution:number;radiusM:number};
export class SurfaceWorkerTaskError extends Error {
 readonly taskKind:FailureKind;readonly taskKey:string;readonly phase:'startup'|'runtime'|'task'|'disposed';
 constructor(taskKind:FailureKind,taskKey:string,phase:'startup'|'runtime'|'task'|'disposed',message:string){super(message);this.name='SurfaceWorkerTaskError';this.taskKind=taskKind;this.taskKey=taskKey;this.phase=phase;}
}
interface Subscriber {resolve:(value:WorkerValue)=>void;reject:(error:Error)=>void;signal?:AbortSignal;abort?:()=>void;}
interface WorkerSlot {id:number;worker:Worker;task:Task|null;ready:boolean;}
interface Task {id:number;key:string;payload:TaskPayload;priority:number;order:number;subscribers:Set<Subscriber>;cancelled:boolean;}
type WorkerReply={type?:string;id?:number;tile?:SurfaceTileData;mesh?:GeodesicTileMesh;error?:string};

/** Малий обмежений пул: задачі надсилаються лише після handshake готовності Worker. */
export class SurfaceTileWorkerPool {
 private slots:WorkerSlot[]=[];private queue:Task[]=[];private pending=new Map<string,Task>();private ids=new Map<number,Task>();
 private sequence=0;private workerSequence=0;private disposed=false;private startupError:Error|null=null;
 private workerStartupErrorsValue=0;private workerRuntimeErrorsValue=0;private workerTaskErrorsValue=0;private cancelledTasksValue=0;private disposedTasksValue=0;
 readonly concurrency:number;readonly maxPendingTasks:number;private readonly workerFactory:()=>Worker;private readonly hasWorkerFactory:boolean;
 constructor(options:{concurrency?:number;maxPendingTasks?:number;workerFactory?:()=>Worker}={}){
  const cores=typeof navigator!=='undefined'&&Number.isFinite(navigator.hardwareConcurrency)?navigator.hardwareConcurrency:4;
  const requested=Math.max(1,Math.floor(options.concurrency??1));
  this.concurrency=Math.max(1,Math.min(2,Math.max(1,cores-3),requested));
  this.maxPendingTasks=Math.max(this.concurrency,Math.min(8,Math.floor(options.maxPendingTasks??4)));
  this.hasWorkerFactory=Boolean(options.workerFactory);
  this.workerFactory=options.workerFactory??(()=>new Worker(new URL('./surface-tile-worker.ts',import.meta.url),{type:'module'}));
  this.start();
 }
 private start():void{
  if(typeof Worker==='undefined'&&!this.hasWorkerFactory){this.workerStartupErrorsValue++;this.startupError=new Error('Web Worker API is unavailable in this browser context.');return;}
  for(let i=0;i<this.concurrency;i++)this.spawn();
 }
 private spawn():void{
  if(this.disposed)return;
  try{
   const worker=this.workerFactory(),slot:WorkerSlot={id:++this.workerSequence,worker,task:null,ready:false};
   worker.onmessage=(event:MessageEvent<WorkerReply>)=>{const reply=event.data;if(reply?.type==='ready'){if(slot.ready)return;slot.ready=true;this.pump();return;}this.finish(slot,reply);};
   worker.onerror=event=>{
    event.preventDefault?.();const task=slot.task;
    if(task){this.workerRuntimeErrorsValue++;this.rejectTask(slot,task,new SurfaceWorkerTaskError(task.payload.kind,task.key,'runtime','Surface worker runtime failure: '+(event.message||'unknown worker error')));}
    else if(!slot.ready){this.workerStartupErrorsValue++;this.startupError=new SurfaceWorkerTaskError('worker-startup','worker:'+slot.id,'startup','Surface worker startup failed: '+(event.message||'worker module could not be initialized'));}
    else{this.workerRuntimeErrorsValue++;this.startupError=new SurfaceWorkerTaskError('worker-runtime','worker:'+slot.id,'runtime','Surface worker failed outside an active task: '+(event.message||'unknown worker error'));}
    this.removeSlot(slot);
   };
   worker.onmessageerror=()=>{this.workerRuntimeErrorsValue++;const task=slot.task;if(task)this.rejectTask(slot,task,new SurfaceWorkerTaskError(task.payload.kind,task.key,'runtime','Surface worker returned a message that could not be deserialized.'));this.removeSlot(slot);};
   this.slots.push(slot);
  }catch(error){this.workerStartupErrorsValue++;this.startupError=error instanceof Error?error:new Error(String(error));}
 }
 private removeSlot(slot:WorkerSlot):void{slot.worker.terminate();this.slots=this.slots.filter(item=>item!==slot);if(this.slots.length===0)this.rejectQueuedWithoutWorkers();else this.pump();}
 private rejectQueuedWithoutWorkers():void{
  if(this.disposed||this.slots.length>0)return;const message=this.startupError?.message??'No healthy surface workers remain.';
  for(const task of this.queue.splice(0)){if(this.pending.get(task.key)===task)this.pending.delete(task.key);this.rejectSubscribers(task,new SurfaceWorkerTaskError('worker-startup',task.key,'startup',message));}
 }
 private rejectSubscribers(task:Task,error:Error):void{for(const s of task.subscribers){if(s.abort)s.signal?.removeEventListener('abort',s.abort);s.reject(error);}task.subscribers.clear();}
 private resolveSubscribers(task:Task,value:WorkerValue):void{for(const s of task.subscribers){if(s.abort)s.signal?.removeEventListener('abort',s.abort);s.resolve(value);}task.subscribers.clear();}
 private rejectTask(slot:WorkerSlot,task:Task,error:Error):void{this.ids.delete(task.id);if(this.pending.get(task.key)===task)this.pending.delete(task.key);slot.task=null;this.workerTaskErrorsValue++;this.rejectSubscribers(task,error);}
 private finish(slot:WorkerSlot,reply:WorkerReply):void{
  const task=slot.task;if(!task)return;
  if(!reply||reply.id!==task.id){this.rejectTask(slot,task,new SurfaceWorkerTaskError(task.payload.kind,task.key,'task','Surface worker returned an invalid task response.'));this.pump();return;}
  this.ids.delete(task.id);slot.task=null;if(this.pending.get(task.key)===task)this.pending.delete(task.key);
  if(task.cancelled||task.subscribers.size===0){this.pump();return;}
  const value=task.payload.kind==='tile'?reply.tile:reply.mesh;
  if(reply.error||!value){this.workerTaskErrorsValue++;this.rejectSubscribers(task,new SurfaceWorkerTaskError(task.payload.kind,task.key,'task',reply.error??'Surface worker returned no data for '+task.key+'.'));}
  else this.resolveSubscribers(task,value);
  this.pump();
 }
 private pump():void{
  if(this.disposed)return;this.queue.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  for(const slot of this.slots){
   if(!slot.ready||slot.task)continue;let task:Task|undefined;
   while(this.queue.length&&!task){const candidate=this.queue.shift()!;if(!candidate.cancelled&&candidate.subscribers.size>0)task=candidate;else if(this.pending.get(candidate.key)===candidate)this.pending.delete(candidate.key);}
   if(!task)continue;slot.task=task;this.ids.set(task.id,task);
   try{slot.worker.postMessage({id:task.id,...task.payload});}
   catch(error){this.rejectTask(slot,task,new SurfaceWorkerTaskError(task.payload.kind,task.key,'task','Surface worker postMessage failed: '+(error instanceof Error?error.message:String(error))));}
  }
 }
 private subscribe<T extends WorkerValue>(task:Task,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)return Promise.reject(new DOMException('Surface request aborted.','AbortError'));
  return new Promise<T>((resolve,reject)=>{
   const s:Subscriber={resolve:value=>resolve(value as T),reject,signal};
   if(signal){s.abort=()=>{task.subscribers.delete(s);reject(new DOMException('Surface request aborted.','AbortError'));if(task.subscribers.size===0){task.cancelled=true;this.cancelledTasksValue++;if(this.pending.get(task.key)===task)this.pending.delete(task.key);const i=this.queue.indexOf(task);if(i>=0)this.queue.splice(i,1);}};signal.addEventListener('abort',s.abort,{once:true});}
   task.subscribers.add(s);
  });
 }
 private enqueue<T extends WorkerValue>(key:string,payload:TaskPayload,priority:number,signal?:AbortSignal):Promise<T>{
  if(this.disposed)return Promise.reject(new DOMException('Surface worker pool is disposed.','AbortError'));
  if(signal?.aborted)return Promise.reject(new DOMException('Surface request aborted.','AbortError'));
  const existing=this.pending.get(key);if(existing){existing.priority=Math.max(existing.priority,priority);this.pump();return this.subscribe<T>(existing,signal);}
  if(this.slots.length===0)return Promise.reject(new SurfaceWorkerTaskError('worker-startup',key,'startup',this.startupError?.message??'No healthy surface workers remain.'));
  if(this.pending.size>=this.maxPendingTasks)return Promise.reject(new SurfaceWorkerTaskError(payload.kind,key,'task','Surface worker queue reached its configured task limit.'));
  const task:Task={id:++this.sequence,key,payload,priority,order:this.sequence,subscribers:new Set(),cancelled:false};
  const promise=this.subscribe<T>(task,signal);this.pending.set(key,task);this.queue.push(task);this.pump();return promise;
 }
 request(request:SurfaceTileRequest,priority=0,signal?:AbortSignal):Promise<SurfaceTileData>{return this.enqueue<SurfaceTileData>(surfaceTileKey(request),{kind:'tile',request},priority,signal);}
 requestMesh(tile:GeoTile,resolution:number,radiusM:number,priority=0):Promise<GeodesicTileMesh>{return this.enqueue<GeodesicTileMesh>('mesh:'+tile.id.key+':'+resolution+':'+radiusM,{kind:'mesh',tile,resolution,radiusM},priority);}
 reprioritize(key:string,priority:number):void{const task=this.pending.get(key);if(task){task.priority=Math.max(task.priority,priority);this.pump();}}
 dispose():void{
  if(this.disposed)return;this.disposed=true;const error=new DOMException('Surface worker task cancelled because its pool was disposed.','AbortError');
  for(const task of this.pending.values()){if(this.ids.has(task.id))this.disposedTasksValue++;else this.cancelledTasksValue++;task.cancelled=true;this.rejectSubscribers(task,error);}
  for(const slot of this.slots)slot.worker.terminate();this.queue=[];this.slots=[];this.ids.clear();this.pending.clear();
 }
 get queuedCount():number{return this.queue.length;}get activeCount():number{return this.slots.filter(s=>s.task!==null).length;}
 get pendingCount():number{return this.pending.size;}get workerCount():number{return this.slots.length;}
 get workerStartupErrors():number{return this.workerStartupErrorsValue;}get workerRuntimeErrors():number{return this.workerRuntimeErrorsValue;}
 get workerTaskErrors():number{return this.workerTaskErrorsValue;}get cancelledTasks():number{return this.cancelledTasksValue;}
 get disposedTasks():number{return this.disposedTasksValue;}get startupFailure():string|null{return this.startupError?.message??null;}
}
