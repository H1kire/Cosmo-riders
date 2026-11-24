import { baseGeoTiles } from './icosphere.ts';
import type { GeodesicTileMesh } from './tile-mesh.ts';
import { VirtualSurfaceManager, SurfaceGpuPageCache } from './virtual-surface-manager.ts';
import type { SurfaceProfile, SurfaceTileRequest, SurfaceTileData } from './surface-tile.ts';
import { GEODESIC_VERTEX_SHADER, GEODESIC_FRAGMENT_SHADER } from '../shaders/geodesic-planet.ts';

function reportLoadingStage(id:string,complete=false):void{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('cosmo-loading-stage',{detail:{id,complete}}));}

export type PlanetSurfaceMode='uv'|'geodesic'|'auto';
export interface GeodesicPlanetFrame {
 readonly model:readonly number[];
 readonly viewProjection:readonly number[];
 readonly cameraPosition:readonly [number,number,number];
 readonly lightPositions:Float32Array;
 readonly lightColors:Float32Array;
 readonly lightIntensities:Float32Array;
 readonly lightCount:number;
 readonly bodyExposure:number;
 readonly sunPosition:readonly [number,number,number];
 readonly sunRadius:number;
 readonly occluderPositions:Float32Array;
 readonly occluderRadii:Float32Array;
 readonly occluderCount:number;
 readonly shadowsEnabled:boolean;
}
interface GpuMesh { readonly position:WebGLBuffer; readonly uv:WebGLBuffer; readonly index:WebGLBuffer; readonly count:number; }
interface Page { readonly request:SurfaceTileRequest; mesh:GpuMesh|null; meshData?:GeodesicTileMesh; data?:SurfaceTileData; layer?:number; error?:string; pending:boolean; retryCount?:number; }

/** GPU renderer for the twenty root faces of one procedural geodesic planet. */
export class GeodesicPlanetRenderer {
 readonly modeDefault:PlanetSurfaceMode='auto';
 readonly resolution:number;
 readonly meshResolution:number;
 readonly gutter=2;
 readonly maxUploadsPerFrame:number;
 readonly gpuBudgetBytes:number;
 readonly cpuBudgetBytes:number;
 private readonly gl:WebGL2RenderingContext;
 private readonly manager:VirtualSurfaceManager;
 private gpu:SurfaceGpuPageCache|null=null;
 private program:WebGLProgram|null=null;
 private readonly pages=new Map<string,Page>();
 private profile:SurfaceProfile|null=null;
 private disposed=false;
 private failed=false;
 private ready=false;
 private readonly locations:Record<string,WebGLUniformLocation|null>={};
 private readonly attribs={direction:-1,uv:-1};
 private generationErrors=0;
 private uploadErrors=0;
 private uploadedPages=0;
 private lastPinnedPages=0;
 private lastError:string|null=null;
 private lastGeneratedPages=0;
 private failedGpuResidentPagesValue=0;
 private failedGpuLayerCapacityValue=0;
 private failedGpuCacheBytesValue=0;

 constructor(gl:WebGL2RenderingContext,options:{resolution?:number;meshResolution?:number;cpuBudgetBytes?:number;gpuBudgetBytes?:number;workerCount?:number;maxUploadsPerFrame?:number}={}){
  this.gl=gl;this.resolution=options.resolution??128;this.meshResolution=options.meshResolution??64;
  this.cpuBudgetBytes=options.cpuBudgetBytes??96*1024*1024;this.gpuBudgetBytes=options.gpuBudgetBytes??32*1024*1024;
  this.maxUploadsPerFrame=Math.max(1,Math.floor(options.maxUploadsPerFrame??2));
  if(!Number.isInteger(this.resolution)||this.resolution<8||this.resolution>1024)throw new RangeError('Geodesic page resolution must be in [8, 1024].');
  if(!Number.isInteger(this.meshResolution)||this.meshResolution<2||this.meshResolution%2!==0||this.meshResolution>64)throw new RangeError('Geodesic mesh resolution must be an even integer in [2, 64].');
  const pageSize=this.resolution+this.gutter*2;
  const maxLayers=Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)),maxTextureSize=Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const vertexTextureUnits=Number(gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)),fragmentTextureUnits=Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)),combinedTextureUnits=Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS));
  const vertexUniformVectors=Number(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)),fragmentUniformVectors=Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)),vertexAttributes=Number(gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
  if(maxLayers<20)throw new Error('WebGL2 exposes fewer than 20 texture-array layers required for the Earth surface.');
  if(maxTextureSize<pageSize)throw new Error('WebGL2 MAX_TEXTURE_SIZE is below the configured geodesic page size.');
  if(vertexTextureUnits<1)throw new Error('Vertex texture sampling is unavailable on this WebGL2 device.');
  if(fragmentTextureUnits<5||combinedTextureUnits<5)throw new Error('Fewer than five fragment/combined texture units are available for geodesic channels.');
  if(vertexAttributes<2||vertexUniformVectors<40||fragmentUniformVectors<96)throw new Error('WebGL2 shader limits are below the geodesic renderer requirements.');
  this.manager=new VirtualSurfaceManager({cpuBudgetBytes:this.cpuBudgetBytes,workerCount:options.workerCount??2});
  try{
   this.gpu=new SurfaceGpuPageCache(gl,this.resolution,this.gutter,this.gpuBudgetBytes);
   if(this.gpu.capacity<20)throw new Error('GPU texture-array capacity is below the twenty root pages required for atomic activation.');
   this.program=this.createProgram();
   this.attribs.direction=gl.getAttribLocation(this.program,'aDirection');this.attribs.uv=gl.getAttribLocation(this.program,'aUv');
   if(this.attribs.direction<0||this.attribs.uv<0)throw new Error('Required geodesic shader attributes are unavailable.');
   for(const name of ['uViewProjection','uModel','uCameraPosition','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows','uLightPositions[0]','uLightColors[0]','uLightIntensities[0]','uLightCount','uBodyExposure','uRadiusM','uPageSize','uResolution','uGutter','uLayer','uAlbedo','uNormal','uHeight','uRoughness','uMaterial']){const location=gl.getUniformLocation(this.program,name);if(location===null)throw new Error('Required geodesic shader uniform is unavailable: '+name);this.locations[name]=location;}
  }catch(error){
   this.failed=true;
   this.generationErrors++;
   this.manager.dispose();
   this.disposeGpuOnly();
   throw error;
  }
 }

 private createProgram():WebGLProgram{
  const gl=this.gl;
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type);if(!shader)throw new Error('Unable to allocate geodesic shader.');gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader)||'Geodesic shader compilation failed.';gl.deleteShader(shader);throw new Error(message);}return shader;};
  let vertex:WebGLShader|null=null,fragment:WebGLShader|null=null;
  try{
   vertex=compile(gl.VERTEX_SHADER,GEODESIC_VERTEX_SHADER);fragment=compile(gl.FRAGMENT_SHADER,GEODESIC_FRAGMENT_SHADER);
   const program=gl.createProgram();if(!program)throw new Error('Unable to allocate geodesic program.');
   gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(program)||'Geodesic program link failed.';gl.deleteProgram(program);throw new Error(message);}
   return program;
  }finally{if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);}
 }

 setPlanetSurface(profile:SurfaceProfile):void{
  if(this.disposed||this.failed)return;
  if(this.profile){if(JSON.stringify(this.profile)===JSON.stringify(profile))return;throw new Error('Geodesic renderer profile is immutable after page requests begin.');}
  this.profile=Object.freeze({...profile});
  this.ready=false;reportLoadingStage('surface');
  for(const tile of baseGeoTiles()){
   const request:SurfaceTileRequest={planetId:profile.bodyId,seed:profile.seed,tile:tile.id,resolution:this.resolution,gutter:this.gutter,profile:this.profile};
   const page:Page={request,mesh:null,pending:true};
   this.pages.set(tile.id.key,page);
   void this.manager.requestMesh(tile,this.meshResolution,profile.meanRadiusM,100).then(mesh=>{
    if(this.disposed||this.failed)return;
    page.meshData=mesh;
   },error=>{if(!this.disposed)this.failRenderer(error);});
   const accept=(data:SurfaceTileData)=>{if(this.disposed||this.failed)return;page.data=data;page.pending=false;page.error=undefined;this.lastError=null;};
   const reject=(error:unknown)=>{
    page.pending=false;page.error=error instanceof Error?error.message:String(error);this.lastError=page.error;this.generationErrors++;
    if(!this.disposed&&!this.failed&&(page.retryCount??0)<1){
     page.retryCount=(page.retryCount??0)+1;page.pending=true;
     void this.manager.request(request,100).then(accept,retryError=>{page.pending=false;page.error=retryError instanceof Error?retryError.message:String(retryError);this.generationErrors++;this.failRenderer(retryError);});
    }else if(!this.disposed&&!this.failed)this.failRenderer(error);
   };
   void this.manager.request(request,100).then(accept,reject);
  }
 }

 private createMesh(directions:Float32Array,uv:Float32Array,indices:Uint32Array):GpuMesh{
  const gl=this.gl,created:WebGLBuffer[]=[];
  const buffer=(target:number,data:Float32Array|Uint32Array):WebGLBuffer=>{const value=gl.createBuffer();if(!value)throw new Error('Unable to allocate geodesic mesh buffer.');created.push(value);gl.bindBuffer(target,value);const ownedBuffer=new ArrayBuffer(data.byteLength);new Uint8Array(ownedBuffer).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));gl.bufferData(target,ownedBuffer,gl.STATIC_DRAW);return value;};
  try{return{position:buffer(gl.ARRAY_BUFFER,directions),uv:buffer(gl.ARRAY_BUFFER,uv),index:buffer(gl.ELEMENT_ARRAY_BUFFER,indices),count:indices.length};}
  catch(error){for(const item of created)gl.deleteBuffer(item);throw error;}
 }

 private failRenderer(error:unknown):void{
  if(this.failed)return;
  this.lastGeneratedPages=this.loadedTileCount;
  this.failedGpuResidentPagesValue=this.gpu?.residentPages??0;
  this.failedGpuLayerCapacityValue=this.gpu?.capacity??0;
  this.failedGpuCacheBytesValue=this.gpuCacheBytes;
  this.failed=true;this.lastError=error instanceof Error?error.message:String(error);
  this.manager.dispose();this.disposeGpuOnly();
 }

 private upload(page:Page):boolean{
  if(page.layer!==undefined&&this.gpu?.getLayer(page.data?.key??'')!==undefined)return true;
  if(!page.data||!this.gpu)return false;
  const key=page.data.key;
  try{
   this.manager.markUploadPending(key);
   const layer=this.gpu.upload(page.data);
   this.manager.markGpuReady(key);
   page.layer=layer;page.error=undefined;this.lastError=null;this.uploadedPages++;
   return true;
  }catch(error){
   page.error=error instanceof Error?error.message:String(error);this.lastError=page.error;this.generationErrors++;this.uploadErrors++;
   return false;
  }
 }

 render(frame:GeodesicPlanetFrame):boolean{
  if(this.disposed||this.failed||!this.program||!this.gpu||!this.profile||this.pages.size!==20)return false;
  const gl=this.gl,visible:Page[]=[];let gpuOperationsThisFrame=0;this.lastPinnedPages=0;
  if(!this.gpu.ready){try{this.gpu.initializeStep();if(this.gpu.ready)reportLoadingStage('gpu');}catch(error){this.failRenderer(error);}return false;}
  for(const page of this.pages.values()){
   if(!page.mesh&&page.meshData&&gpuOperationsThisFrame<this.maxUploadsPerFrame){gpuOperationsThisFrame++;try{page.mesh=this.createMesh(page.meshData.directions,page.meshData.textureCoordinates,page.meshData.indices);page.meshData=undefined;}catch(error){this.failRenderer(error);return false;}}
   if(!page.mesh)continue;
   if((page.layer===undefined||this.gpu.getLayer(page.data?.key??'')===undefined)&&page.data&&gpuOperationsThisFrame<this.maxUploadsPerFrame){gpuOperationsThisFrame++;if(!this.upload(page)){this.failRenderer(page.error??'GPU page upload failed.');return false;}}
   const layer=this.gpu.getLayer(page.data?.key??'');
   if(layer!==undefined&&page.mesh){page.layer=layer;visible.push(page);}
  }
  this.ready=visible.length===20&&[...this.pages.values()].every(page=>page.layer!==undefined&&!page.error);
  if(!this.ready)return false;
  reportLoadingStage('surface',true);reportLoadingStage('gpu',true);
  const pinned:string[]=[];
  try{
   for(const page of visible){const key=page.data?.key??'';if(!this.gpu.pin(key))throw new Error('GPU page disappeared before it could be pinned: '+key);pinned.push(key);this.manager.markVisible(key,true);}
   gl.useProgram(this.program);
   gl.uniformMatrix4fv(this.locations.uViewProjection,false,new Float32Array(frame.viewProjection));
   gl.uniformMatrix4fv(this.locations.uModel,false,new Float32Array(frame.model));
   gl.uniform3fv(this.locations.uCameraPosition,new Float32Array(frame.cameraPosition));
   gl.uniform3fv(this.locations['uLightPositions[0]'],frame.lightPositions);
   gl.uniform3fv(this.locations['uLightColors[0]'],frame.lightColors);
   gl.uniform1fv(this.locations['uLightIntensities[0]'],frame.lightIntensities);
   gl.uniform1i(this.locations.uLightCount,frame.lightCount);
   gl.uniform1f(this.locations.uBodyExposure,frame.bodyExposure);
   gl.uniform3fv(this.locations.uSunPosition,new Float32Array(frame.sunPosition));gl.uniform1f(this.locations.uSunRadius,frame.sunRadius);
   gl.uniform3fv(this.locations['uOccluders[0]'],frame.occluderPositions);gl.uniform1fv(this.locations['uOccluderRadii[0]'],frame.occluderRadii);
   gl.uniform1i(this.locations.uOccluderCount,frame.occluderCount);gl.uniform1i(this.locations.uShadows,frame.shadowsEnabled?1:0);
   gl.uniform1f(this.locations.uRadiusM,this.profile.meanRadiusM);
   gl.uniform1f(this.locations.uPageSize,this.gpu.pageSize);
   gl.uniform1f(this.locations.uResolution,this.resolution);
   gl.uniform1f(this.locations.uGutter,this.gutter);
   const textures=[this.gpu.albedo,this.gpu.normal,this.gpu.height,this.gpu.roughness,this.gpu.material];
   const uniforms=['uAlbedo','uNormal','uHeight','uRoughness','uMaterial'];
   for(let i=0;i<textures.length;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D_ARRAY,textures[i]);gl.uniform1i(this.locations[uniforms[i]],i);}
   gl.uniform1i(this.locations.uHeight,2);
   gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
   for(const page of visible){
    if(!page.mesh)continue;
    const layer=this.gpu.getLayer(page.data?.key??'');if(layer===undefined)continue;
    gl.uniform1f(this.locations.uLayer,layer);
    gl.bindBuffer(gl.ARRAY_BUFFER,page.mesh.position);gl.enableVertexAttribArray(this.attribs.direction);gl.vertexAttribPointer(this.attribs.direction,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,page.mesh.uv);gl.enableVertexAttribArray(this.attribs.uv);gl.vertexAttribPointer(this.attribs.uv,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,page.mesh.index);
    gl.drawElements(gl.TRIANGLES,page.mesh.count,gl.UNSIGNED_INT,0);
   }
   gl.disable(gl.CULL_FACE);
   return true;
  }catch(error){this.generationErrors++;this.failRenderer(error);return false;}
  finally{this.lastPinnedPages=pinned.length;for(const key of pinned){this.gpu?.unpin(key);if(!this.failed)this.manager.markVisible(key,false);}if(this.failed){this.manager.dispose();this.disposeGpuOnly();}gl.disable(gl.CULL_FACE);}
 }

 private disposeGpuOnly():void{
  for(const page of this.pages.values())if(page.mesh)for(const buffer of [page.mesh.position,page.mesh.uv,page.mesh.index])this.gl.deleteBuffer(buffer);
  this.pages.clear();this.gpu?.dispose();this.gpu=null;this.lastPinnedPages=0;
  if(this.program)this.gl.deleteProgram(this.program);this.program=null;
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.manager.dispose();this.disposeGpuOnly();}
 get isReady():boolean{return this.ready;}
 get isFailed():boolean{return this.failed;}
 get loadedTileCount():number{return Math.max(this.lastGeneratedPages,[...this.pages.values()].filter(page=>Boolean(page.data)).length);}
 get visibleTileCount():number{return this.ready?20:0;}
 get gpuResidentTileCount():number{return this.gpu?.residentPages??0;}
 get workerCount():number{return this.manager.workerCount;}
 get queuedCount():number{return this.manager.queuedCount;}
 get cpuCacheBytes():number{return this.manager.memoryBytes;}
 get gpuPinnedPages():number{return this.lastPinnedPages;}
 get errorCount():number{return this.generationErrors;}
 get uploadErrorCount():number{return this.uploadErrors;}
 get uploadedPageCount():number{return this.uploadedPages;}
 get activeWorkerCount():number{return this.manager.activeWorkers;}
 get cpuCacheSize():number{return this.manager.cacheSize;}
 get gpuCacheBytes():number{return this.gpu?.allocatedBytes??0;}
 get allocatedTextureArrays():number{return this.gpu?.ready?5:0;}
 get failedGpuCacheBytes():number{return this.failedGpuCacheBytesValue;}
 get failedGpuLayerCapacity():number{return this.failedGpuLayerCapacityValue;}
 get failedGpuResidentPages():number{return this.failedGpuResidentPagesValue;}
 get rendererState():'failed'|'ready'|'preparing'|'idle'{return this.failed?'failed':this.ready?'ready':this.profile?'preparing':'idle';}
 get gpuPageBytes():number{return(this.gpu?.pageSize??0)*(this.gpu?.pageSize??0)*13;}
 get gpuPageSize():number{return this.gpu?.pageSize??0;}
 get gpuLayerCapacity():number{return this.gpu?.ready?this.gpu.capacity:0;}
 get fallbackReason():string|null{if(this.failed)return this.lastError??'Geodesic renderer failed.';if(this.lastError)return this.lastError;if(!this.profile)return 'Earth surface profile has not been requested yet.';if(!this.ready)return 'Preparing geodesic pages: '+this.loadedTileCount+'/20 generated, '+this.gpuResidentTileCount+'/20 uploaded.';return null;}
}

