import { surfaceTileKey, type SurfaceTileData, type SurfaceTileRequest } from './surface-tile.ts';
import { SurfaceTileWorkerPool } from './surface-worker-pool.ts';

export type SurfaceTileState='Unrequested'|'Queued'|'Generating'|'CPU Ready'|'Upload Pending'|'GPU Ready'|'Visible'|'Evicted'|'Failed';
export interface SurfaceTileStatus { readonly key:string; state:SurfaceTileState; error?:string; lastUsed:number; priority:number; }
interface CpuEntry { tile:SurfaceTileData; bytes:number; used:number; }

/** Керує станами тайлів та обмеженим CPU LRU-кешем. */
export class VirtualSurfaceManager {
 private readonly pool:SurfaceTileWorkerPool;
 private readonly ownsPool:boolean;
 private readonly abortController=new AbortController();
 private disposed=false;
 private readonly cpu=new Map<string,CpuEntry>();
 private readonly statuses=new Map<string,SurfaceTileStatus>();
 private clock=0; private bytes=0;
 constructor(options:{cpuBudgetBytes?:number;workerCount?:number;pool?:SurfaceTileWorkerPool}={}){
  this.cpuBudgetBytes=Math.max(1,options.cpuBudgetBytes??96*1024*1024);
  this.ownsPool=!options.pool;
  this.pool=options.pool??new SurfaceTileWorkerPool({concurrency:options.workerCount});
 }
 readonly cpuBudgetBytes:number;
 private status(key:string,priority=0):SurfaceTileStatus{
  let item=this.statuses.get(key);
  if(!item){item={key,state:'Unrequested',lastUsed:++this.clock,priority};this.statuses.set(key,item);}
  item.lastUsed=++this.clock;item.priority=Math.max(item.priority,priority);return item;
 }
 private remember(tile:SurfaceTileData):void{
  const bytes=tile.albedo.byteLength+tile.normal.byteLength+tile.height.byteLength+tile.roughness.byteLength+tile.materialId.byteLength;
  const old=this.cpu.get(tile.key);if(old)this.bytes-=old.bytes;
  while(this.bytes+bytes>this.cpuBudgetBytes&&this.cpu.size){
   let oldestKey:string|undefined,oldest=Infinity;
   for(const [key,value] of this.cpu)if(value.used<oldest){oldest=value.used;oldestKey=key;}
   if(oldestKey===undefined)break;
   const evicted=this.cpu.get(oldestKey)!;this.bytes-=evicted.bytes;this.cpu.delete(oldestKey);
   const state=this.statuses.get(oldestKey);if(state&&state.state!=='Visible')state.state='Evicted';
  }
  if(bytes<=this.cpuBudgetBytes){this.cpu.set(tile.key,{tile,bytes,used:++this.clock});this.bytes+=bytes;}
 }
 requestMesh(tile:import('./icosphere.ts').GeoTile,resolution:number,radiusM:number,priority=0):Promise<import('./tile-mesh.ts').GeodesicTileMesh>{
  if(this.disposed)return Promise.reject(new DOMException('Surface manager is disposed.','AbortError'));
  return this.pool.requestMesh(tile,resolution,radiusM,priority,this.abortController.signal);
 }
 async request(request:SurfaceTileRequest,priority=0,signal?:AbortSignal):Promise<SurfaceTileData>{
  if(this.disposed)throw new DOMException('Surface manager is disposed.','AbortError');
  const key=surfaceTileKey(request),state=this.status(key,priority),hit=this.cpu.get(key);
  if(hit){hit.used=++this.clock;state.state='CPU Ready';return hit.tile;}
  if(state.state==='Queued'||state.state==='Generating') {
   // Пул дедуплікує запити за ключем; повторний запит підвищує пріоритет черги.
   this.pool.reprioritize(key,priority);
  }
  state.state='Queued';state.error=undefined;
  try{
   const combinedSignal=signal?AbortSignal.any([this.abortController.signal,signal]):this.abortController.signal;
   const promise=this.pool.request(request,priority,combinedSignal);
   state.state='Generating';
   const tile=await promise;if(this.disposed)throw new DOMException('Surface manager is disposed.','AbortError');this.remember(tile);state.state='CPU Ready';return tile;
  }catch(error){
   if(error instanceof DOMException&&error.name==='AbortError'){state.state='Evicted';}
   else{state.state='Failed';state.error=error instanceof Error?error.message:String(error);}
   throw error;
  }
 }
 markUploadPending(key:string):void{const state=this.status(key);if(state.state==='CPU Ready')state.state='Upload Pending';}
 markGpuReady(key:string):void{const state=this.status(key);if(state.state==='Upload Pending'||state.state==='CPU Ready')state.state='GPU Ready';}
 markVisible(key:string,visible:boolean):void{const state=this.status(key);if(visible){state.state='Visible';}else if(state.state==='Visible')state.state=this.cpu.has(key)?'GPU Ready':'Evicted';}
 getCached(key:string):SurfaceTileData|undefined{const entry=this.cpu.get(key);if(entry)entry.used=++this.clock;return entry?.tile;}
 evict(key:string):void{const entry=this.cpu.get(key);if(entry){this.bytes-=entry.bytes;this.cpu.delete(key);}const state=this.statuses.get(key);if(state&&state.state!=='Visible')state.state='Evicted';}
 dispose():void{if(this.disposed)return;this.disposed=true;this.abortController.abort();if(this.ownsPool)this.pool.dispose();this.cpu.clear();this.statuses.clear();this.bytes=0;}
 get workerPool():SurfaceTileWorkerPool{return this.pool;}
 get memoryBytes():number{return this.bytes;}
 get cacheSize():number{return this.cpu.size;}
 get queuedCount():number{return this.pool.queuedCount;}
 get pendingCount():number{return this.pool.pendingCount;}
 get workerStartupErrors():number{return this.pool.workerStartupErrors;}
 get workerRuntimeErrors():number{return this.pool.workerRuntimeErrors;}
 get workerTaskErrors():number{return this.pool.workerTaskErrors;}
 get cancelledTasks():number{return this.pool.cancelledTasks;}
 get disposedTasks():number{return this.pool.disposedTasks;}
 get startupFailure():string|null{return this.pool.startupFailure;}
 get activeWorkers():number{return this.pool.activeCount;}
 get workerCount():number{return this.pool.workerCount;}
 get diagnostics():readonly SurfaceTileStatus[]{return[...this.statuses.values()].map(item=>({...item}));}
}

/** GPU texture-array сторінки з LRU-витісненням; кожен шар є одним трикутним VT-тайлом. */
export class SurfaceGpuPageCache {
 private readonly textures:WebGLTexture[]=[];
 get albedo():WebGLTexture{return this.textures[0]!;}
 get normal():WebGLTexture{return this.textures[1]!;}
 get height():WebGLTexture{return this.textures[2]!;}
 get roughness():WebGLTexture{return this.textures[3]!;}
 get material():WebGLTexture{return this.textures[4]!;}
 get ready():boolean{return this.textures.length===5;}
 get allocatedTextureCount():number{return this.textures.length;}
 get allocatedBytes():number{return this.pageSize*this.pageSize*this.capacity*[4,3,4,1,1].slice(0,this.textures.length).reduce((sum,value)=>sum+value,0);}
 readonly pageSize:number; readonly capacity:number;
 private readonly slots:{key:string|null;used:number}[]=[];
 private readonly pins=new Map<string,number>();
 private clock=0; private readonly pages=new Map<string,number>();
 constructor(private readonly gl:WebGL2RenderingContext,resolution:number,gutter=2,budgetBytes=32*1024*1024){
  this.pageSize=resolution+gutter*2;
  const maxLayers=gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const bytesPerPage=this.pageSize*this.pageSize*13;
  this.capacity=Math.min(maxLayers,20,Math.floor(budgetBytes/bytesPerPage));
  if(!Number.isFinite(this.capacity)||this.capacity<1)throw new Error('GPU texture-array budget or layer limit cannot hold one surface page.');
  for(let i=0;i<this.capacity;i++)this.slots.push({key:null,used:0});
 }
 /** Allocate one of the five texture arrays per frame to bound GPU allocation stalls. */
 initializeStep():boolean{
  if(this.ready)return true;
  const g=this.gl,index=this.textures.length;
  if(g.isContextLost())throw new Error('WebGL context was lost before surface texture allocation.');
  const previousActive=g.getParameter(g.ACTIVE_TEXTURE) as number;
  const previousBinding=g.getParameter(g.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture|null;
  const definitions=[
   {internal:g.RGBA8,format:g.RGBA,type:g.UNSIGNED_BYTE,filter:g.LINEAR,bytes:4},
   {internal:g.RGB8,format:g.RGB,type:g.UNSIGNED_BYTE,filter:g.LINEAR,bytes:3},
   {internal:g.R32F,format:g.RED,type:g.FLOAT,filter:g.NEAREST,bytes:4},
   {internal:g.R8,format:g.RED,type:g.UNSIGNED_BYTE,filter:g.LINEAR,bytes:1},
   {internal:g.R8,format:g.RED,type:g.UNSIGNED_BYTE,filter:g.NEAREST,bytes:1}
  ];
  const definition=definitions[index];if(!definition)return this.ready;
  const texture=g.createTexture();if(!texture)throw new Error('Не вдалося виділити GPU texture array.');
  try{
   g.bindTexture(g.TEXTURE_2D_ARRAY,texture);
   g.texStorage3D(g.TEXTURE_2D_ARRAY,1,definition.internal,this.pageSize,this.pageSize,this.capacity);
   const allocationError=g.getError();if(allocationError!==g.NO_ERROR)throw new Error('GPU texture-array allocation failed with WebGL error '+allocationError+'.');
   g.texParameteri(g.TEXTURE_2D_ARRAY,g.TEXTURE_MIN_FILTER,definition.filter);
   g.texParameteri(g.TEXTURE_2D_ARRAY,g.TEXTURE_MAG_FILTER,definition.filter);
   g.texParameteri(g.TEXTURE_2D_ARRAY,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);
   g.texParameteri(g.TEXTURE_2D_ARRAY,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
   this.textures.push(texture);
   return this.ready;
  }catch(error){g.deleteTexture(texture);throw error;}
  finally{g.bindTexture(g.TEXTURE_2D_ARRAY,previousBinding);g.activeTexture(previousActive);}
 }
 upload(tile:SurfaceTileData):number{
  const g=this.gl;
  if(tile.resolution+tile.gutter*2!==this.pageSize)throw new Error('Tile dimensions do not match the GPU page cache.');
  const texels=this.pageSize*this.pageSize;
  if(tile.albedo.length!==texels*4||tile.normal.length!==texels*3||tile.height.length!==texels||tile.roughness.length!==texels||tile.materialId.length!==texels)throw new Error('Surface tile channel lengths do not match the five GPU texture arrays.');
  let layer=this.pages.get(tile.key),newSlot=layer===undefined,slot=layer;
  if(newSlot){
   slot=this.slots.findIndex(item=>item.key===null);
   if(slot<0){
    let oldest=Infinity;
    for(let i=0;i<this.slots.length;i++){
     const candidate=this.slots[i],pinCount=candidate.key?this.pins.get(candidate.key)??0:0;
     if(pinCount===0&&candidate.used<oldest){oldest=candidate.used;slot=i;}
    }
    if(slot<0)throw new Error('All GPU texture-array layers are pinned by visible tiles.');
   }
   layer=slot;
  }
  if(g.isContextLost())throw new Error('WebGL context was lost before surface page upload.');
  const w=this.pageSize,previousAlignment=g.getParameter(g.UNPACK_ALIGNMENT) as number;
  const previousActive=g.getParameter(g.ACTIVE_TEXTURE) as number;
  const previousBinding=g.getParameter(g.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture|null;
  g.activeTexture(g.TEXTURE0);const unitZeroBinding=g.getParameter(g.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture|null;
  const put=(texture:WebGLTexture,format:number,type:number,data:ArrayBufferView)=>{g.bindTexture(g.TEXTURE_2D_ARRAY,texture);g.texSubImage3D(g.TEXTURE_2D_ARRAY,0,0,0,layer!,w,w,1,format,type,data);};
  try{
   g.pixelStorei(g.UNPACK_ALIGNMENT,1);
   put(this.albedo,g.RGBA,g.UNSIGNED_BYTE,tile.albedo);put(this.normal,g.RGB,g.UNSIGNED_BYTE,tile.normal);
   put(this.height,g.RED,g.FLOAT,tile.height);put(this.roughness,g.RED,g.UNSIGNED_BYTE,tile.roughness);put(this.material,g.RED,g.UNSIGNED_BYTE,tile.materialId);
   const uploadError=g.getError();if(uploadError!==g.NO_ERROR)throw new Error('GPU surface page upload failed with WebGL error '+uploadError+'.');
  }catch(error){
   if(slot!==undefined){const damagedKey=this.slots[slot].key;if(damagedKey)this.pages.delete(damagedKey);this.slots[slot].key=null;this.slots[slot].used=0;}
   throw error;
  }finally{
   g.pixelStorei(g.UNPACK_ALIGNMENT,previousAlignment);
   g.bindTexture(g.TEXTURE_2D_ARRAY,unitZeroBinding);g.activeTexture(previousActive);
   if(previousActive!==g.TEXTURE0)g.bindTexture(g.TEXTURE_2D_ARRAY,previousBinding);
  }
  if(newSlot&&slot!==undefined){const previous=this.slots[slot].key;if(previous)this.pages.delete(previous);this.slots[slot].key=tile.key;this.pages.set(tile.key,slot);}
  this.slots[layer!].used=++this.clock;return layer!;
 }
 getLayer(key:string):number|undefined{const layer=this.pages.get(key);if(layer!==undefined)this.slots[layer].used=++this.clock;return layer;}
 /** Закріплює сторінку до завершення кадру, щоб LRU не перевикористав її шар. */
 pin(key:string):boolean{if(!this.pages.has(key))return false;this.pins.set(key,(this.pins.get(key)??0)+1);return true;}
 /** Знімає одне закріплення; повторні pin-виклики потребують парних unpin. */
 unpin(key:string):void{const count=this.pins.get(key)??0;if(count<=1)this.pins.delete(key);else this.pins.set(key,count-1);}
 isPinned(key:string):boolean{return(this.pins.get(key)??0)>0;}
 get pinnedPages():number{return this.pins.size;}
 dispose():void{const g=this.gl;for(const texture of this.textures)g.deleteTexture(texture);this.textures.length=0;this.pages.clear();this.pins.clear();for(const slot of this.slots)slot.key=null;}
 get residentPages():number{return this.pages.size;}
}
