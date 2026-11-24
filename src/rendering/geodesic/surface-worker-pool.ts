import { surfaceTileKey, type SurfaceTileData, type SurfaceTileRequest } from './surface-tile.ts';
interface WorkerSlot { worker:Worker; task:Task|null; }
interface Task { id:number; key:string; request:SurfaceTileRequest; priority:number; order:number; resolve:(tile:SurfaceTileData)=>void; reject:(error:Error)=>void; signal?:AbortSignal; abort?:()=>void; }
type WorkerReply={id:number;tile?:SurfaceTileData;error?:string};

/** Обмежений пул воркерів; головний потік ніколи не виконує генерацію тайлів. */
export class SurfaceTileWorkerPool {
 private slots:WorkerSlot[]=[];
 private queue:Task[]=[];
 private pending=new Map<string,Promise<SurfaceTileData>>();
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
   worker.onmessage=(event:MessageEvent<WorkerReply>)=>this.finish(slot,event.data);
   worker.onerror=event=>{event.preventDefault?.();const task=slot.task;if(task){this.ids.delete(task.id);this.pending.delete(task.key);task.reject(new Error('Surface worker failed: '+(event.message||'unknown error')));}slot.task=null;worker.terminate();this.slots=this.slots.filter(item=>item!==slot);this.spawn();this.pump();};
   this.slots.push(slot);
  }catch(error){
   // Worker відсутній: повертаємо контрольовану помилку замість синхронного fallback.
   this.startupError=error instanceof Error?error:new Error(String(error));
  }
 }
 private startupError:Error|null=null;
 private finish(slot:WorkerSlot,reply:WorkerReply):void{
  const task=this.ids.get(reply.id);if(!task||slot.task!==task)return;
  this.ids.delete(reply.id);slot.task=null;this.pending.delete(task.key);
  task.signal?.removeEventListener('abort',task.abort!);
  if(task.signal?.aborted){task.reject(new DOMException('Surface request aborted.','AbortError'));}
  else if(reply.tile)task.resolve(reply.tile);
  else task.reject(new Error(reply.error??'Surface tile worker returned no data.'));
  this.pump();
 }
 private pump():void{
  if(this.disposed)return;
  this.queue.sort((a,b)=>b.priority-a.priority||a.order-b.order);
  for(const slot of this.slots){
   if(slot.task||!this.queue.length)continue;
   const task=this.queue.shift()!;
   if(task.signal?.aborted){this.pending.delete(task.key);task.reject(new DOMException('Surface request aborted.','AbortError'));continue;}
   slot.task=task;this.ids.set(task.id,task);
   try{slot.worker.postMessage({id:task.id,request:task.request});}
   catch(error){slot.task=null;this.ids.delete(task.id);this.pending.delete(task.key);task.reject(error instanceof Error?error:new Error(String(error)));}
  }
 }
 request(request:SurfaceTileRequest,priority=0,signal?:AbortSignal):Promise<SurfaceTileData>{
  if(this.disposed)return Promise.reject(new Error('Surface worker pool is disposed.'));
  const key=surfaceTileKey(request),existing=this.pending.get(key);if(existing)return existing;
  if(this.startupError)return Promise.reject(this.startupError);
  if(signal?.aborted)return Promise.reject(new DOMException('Surface request aborted.','AbortError'));
  const promise=new Promise<SurfaceTileData>((resolve,reject)=>{
   const task:Task={id:++this.sequence,key,request,priority,order:this.sequence,resolve,reject,signal};
   if(signal){task.abort=()=>{const index=this.queue.indexOf(task);if(index>=0){this.queue.splice(index,1);this.pending.delete(key);reject(new DOMException('Surface request aborted.','AbortError'));}};signal.addEventListener('abort',task.abort,{once:true});}
   this.queue.push(task);
  });
  this.pending.set(key,promise);this.pump();return promise;
 }
 reprioritize(key:string,priority:number):void{const task=this.queue.find(item=>item.key===key);if(task)task.priority=priority;this.pump();}
 dispose():void{
  if(this.disposed)return;this.disposed=true;
  const error=new Error('Surface worker pool disposed.');
  for(const task of this.queue){task.signal?.removeEventListener('abort',task.abort!);task.reject(error);}
  for(const slot of this.slots){if(slot.task){slot.task.signal?.removeEventListener('abort',slot.task.abort!);slot.task.reject(error);}slot.worker.terminate();}
  this.queue=[];this.slots=[];this.ids.clear();this.pending.clear();
 }
 get queuedCount():number{return this.queue.length;}
 get activeCount():number{return this.slots.filter(slot=>slot.task!==null).length;}
 get pendingCount():number{return this.pending.size;}
 get workerCount():number{return this.slots.length;}
}
