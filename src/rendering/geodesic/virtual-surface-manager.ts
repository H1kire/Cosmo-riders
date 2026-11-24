import { surfaceTileKey, type SurfaceTileData, type SurfaceTileRequest } from './surface-tile.ts';
import { SurfaceTileWorkerPool } from './surface-worker-pool.ts';

export type SurfaceTileState='Unrequested'|'Queued'|'Generating'|'CPU Ready'|'Upload Pending'|'GPU Ready'|'Visible'|'Evicted'|'Failed';
export interface SurfaceTileStatus { readonly key:string; state:SurfaceTileState; error?:string; lastUsed:number; priority:number; }
interface CpuEntry { tile:SurfaceTileData; bytes:number; used:number; }

/** Керує станами тайлів та обмеженим CPU LRU-кешем. */
export class VirtualSurfaceManager {
 private readonly pool:SurfaceTileWorkerPool;
 private readonly cpu=new Map<string,CpuEntry>();
 private readonly statuses=new Map<string,SurfaceTileStatus>();
 private clock=0; private bytes=0;
 private readonly pins=new Map<string,number>();
 constructor(options:{cpuBudgetBytes?:number;workerCount?:number;pool?:SurfaceTileWorkerPool}={}){
  this.cpuBudgetBytes=Math.max(1,options.cpuBudgetBytes??96*1024*1024);
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
 async request(request:SurfaceTileRequest,priority=0,signal?:AbortSignal):Promise<SurfaceTileData>{
  const key=surfaceTileKey(request),state=this.status(key,priority),hit=this.cpu.get(key);
  if(hit){hit.used=++this.clock;state.state='CPU Ready';return hit.tile;}
  if(state.state==='Queued'||state.state==='Generating') {
   // Пул дедуплікує запити за ключем; повторний запит підвищує пріоритет черги.
   this.pool.reprioritize(key,priority);
  }
  state.state='Queued';state.error=undefined;
  try{
   const promise=this.pool.request(request,priority,signal);
   state.state='Generating';
   const tile=await promise;this.remember(tile);state.state='CPU Ready';return tile;
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
 dispose():void{this.pool.dispose();this.cpu.clear();this.statuses.clear();this.bytes=0;}
 get memoryBytes():number{return this.bytes;}
 get cacheSize():number{return this.cpu.size;}
 get queuedCount():number{return this.pool.queuedCount;}
 get activeWorkers():number{return this.pool.activeCount;}
 get workerCount():number{return this.pool.workerCount;}
 get diagnostics():readonly SurfaceTileStatus[]{return[...this.statuses.values()].map(item=>({...item}));}
}

/** GPU texture-array сторінки з LRU-витісненням; кожен шар є одним трикутним VT-тайлом. */
export class SurfaceGpuPageCache {
 readonly albedo:WebGLTexture; readonly normal:WebGLTexture; readonly height:WebGLTexture;
 readonly roughness:WebGLTexture; readonly material:WebGLTexture;
 readonly pageSize:number; readonly capacity:number;
 private readonly slots:{key:string|null;used:number}[]=[];
 private clock=0; private readonly pages=new Map<string,number>();
 constructor(private readonly gl:WebGL2RenderingContext,resolution:number,gutter=2,budgetBytes=32*1024*1024){
  this.pageSize=resolution+gutter*2;
  const maxLayers=gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const bytesPerPage=this.pageSize*this.pageSize*13;
  this.capacity=Math.max(1,Math.min(maxLayers,Math.floor(budgetBytes/bytesPerPage)));
  const create=(internal:number,format:number,type:number):WebGLTexture=>{
   const texture=gl.createTexture();if(!texture)throw new Error('Не вдалося виділити GPU texture array.');
   gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);gl.texStorage3D(gl.TEXTURE_2D_ARRAY,1,internal,this.pageSize,this.pageSize,this.capacity);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   void format;void type;return texture;
  };
  this.albedo=create(gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE);
  this.normal=create(gl.RGB8,gl.RGB,gl.UNSIGNED_BYTE);
  this.height=create(gl.R32F,gl.RED,gl.FLOAT);
  this.roughness=create(gl.R8,gl.RED,gl.UNSIGNED_BYTE);
  this.material=create(gl.R8,gl.RED,gl.UNSIGNED_BYTE);
  for(let i=0;i<this.capacity;i++)this.slots.push({key:null,used:0});
 }
 upload(tile:SurfaceTileData):number{
  const g=this.gl;
  if(tile.resolution+tile.gutter*2!==this.pageSize)throw new Error('Tile dimensions do not match the GPU page cache.');
  let layer=this.pages.get(tile.key);
  if(layer===undefined){
   let slot=this.slots.findIndex(item=>item.key===null);
   if(slot<0){
    let oldest=Infinity;
    for(let i=0;i<this.slots.length;i++){
     const candidate=this.slots[i],pinCount=candidate.key?this.pins.get(candidate.key)??0:0;
     if(pinCount===0&&candidate.used<oldest){oldest=candidate.used;slot=i;}
    }
    if(slot<0)throw new Error('All GPU texture-array layers are pinned by visible tiles.');
    const old=this.slots[slot].key;if(old)this.pages.delete(old);
   }
   layer=slot;this.slots[slot].key=tile.key;this.pages.set(tile.key,layer);
  }
  const w=this.pageSize,previousAlignment=g.getParameter(g.UNPACK_ALIGNMENT) as number;
  g.pixelStorei(g.UNPACK_ALIGNMENT,1);
  const put=(texture:WebGLTexture,format:number,type:number,data:ArrayBufferView)=>{g.bindTexture(g.TEXTURE_2D_ARRAY,texture);g.texSubImage3D(g.TEXTURE_2D_ARRAY,0,0,0,layer!,w,w,1,format,type,data);};
  try{
   put(this.albedo,g.RGBA,g.UNSIGNED_BYTE,tile.albedo);put(this.normal,g.RGB,g.UNSIGNED_BYTE,tile.normal);
   put(this.height,g.RED,g.FLOAT,tile.height);put(this.roughness,g.RED,g.UNSIGNED_BYTE,tile.roughness);put(this.material,g.RED,g.UNSIGNED_BYTE,tile.materialId);
  }finally{g.pixelStorei(g.UNPACK_ALIGNMENT,previousAlignment);}
  this.slots[layer].used=++this.clock;return layer;
 }
 getLayer(key:string):number|undefined{const layer=this.pages.get(key);if(layer!==undefined)this.slots[layer].used=++this.clock;return layer;}
 /** Закріплює сторінку до завершення кадру, щоб LRU не перевикористав її шар. */
 pin(key:string):boolean{if(!this.pages.has(key))return false;this.pins.set(key,(this.pins.get(key)??0)+1);return true;}
 /** Знімає одне закріплення; повторні pin-виклики потребують парних unpin. */
 unpin(key:string):void{const count=this.pins.get(key)??0;if(count<=1)this.pins.delete(key);else this.pins.set(key,count-1);}
 isPinned(key:string):boolean{return(this.pins.get(key)??0)>0;}
 get pinnedPages():number{return this.pins.size;}
 dispose():void{const g=this.gl;for(const texture of [this.albedo,this.normal,this.height,this.roughness,this.material])g.deleteTexture(texture);this.pages.clear();this.pins.clear();for(const slot of this.slots)slot.key=null;}
 get residentPages():number{return this.pages.size;}
}
