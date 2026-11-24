import { baseGeoTiles } from './icosphere.ts';
import { buildGeodesicTileMesh } from './tile-mesh.ts';
import { VirtualSurfaceManager, SurfaceGpuPageCache } from './virtual-surface-manager.ts';
import type { SurfaceProfile, SurfaceTileRequest, SurfaceTileData } from './surface-tile.ts';
import { GEODESIC_VERTEX_SHADER, GEODESIC_FRAGMENT_SHADER } from '../shaders/geodesic-planet.ts';

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
interface Page { readonly request:SurfaceTileRequest; readonly mesh:GpuMesh; data?:SurfaceTileData; layer?:number; error?:string; pending:boolean; }

/** GPU renderer for the twenty root faces of one procedural geodesic planet. */
export class GeodesicPlanetRenderer {
 readonly modeDefault:PlanetSurfaceMode='auto';
 readonly resolution=128;
 readonly meshResolution=64;
 readonly gutter=2;
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

 constructor(gl:WebGL2RenderingContext,options:{cpuBudgetBytes?:number;gpuBudgetBytes?:number;workerCount?:number}={}){
  this.gl=gl;
  this.manager=new VirtualSurfaceManager({cpuBudgetBytes:options.cpuBudgetBytes??96*1024*1024,workerCount:options.workerCount??2});
  try{
   this.gpu=new SurfaceGpuPageCache(gl,this.resolution,this.gutter,options.gpuBudgetBytes??32*1024*1024);
   if(this.gpu.capacity<20)throw new Error('GPU texture-array capacity is below the twenty root pages required for atomic activation.');
   this.program=this.createProgram();
   this.attribs.direction=gl.getAttribLocation(this.program,'aDirection');
   this.attribs.uv=gl.getAttribLocation(this.program,'aUv');
   for(const name of ['uViewProjection','uModel','uCameraPosition','uHeight','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows','uLightPositions[0]','uLightColors[0]','uLightIntensities[0]','uLightCount','uBodyExposure','uRadiusM','uPageSize','uResolution','uGutter','uLayer','uAlbedo','uNormal','uHeight','uRoughness','uMaterial'])this.locations[name]=gl.getUniformLocation(this.program,name);
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
  this.ready=false;
  try{
   for(const tile of baseGeoTiles()){
    const request:SurfaceTileRequest={planetId:profile.bodyId,seed:profile.seed,tile:tile.id,resolution:this.resolution,gutter:this.gutter,profile:this.profile};
    const mesh=buildGeodesicTileMesh(tile,this.meshResolution,profile.meanRadiusM);
    const gpuMesh=this.createMesh(mesh.directions,mesh.textureCoordinates,mesh.indices);
    const page:Page={request,mesh:gpuMesh,pending:true};
    this.pages.set(tile.id.key,page);
    void this.manager.request(request,100).then(data=>{if(this.disposed)return;page.data=data;page.pending=false;},error=>{page.pending=false;page.error=error instanceof Error?error.message:String(error);this.generationErrors++;});
   }
  }catch(error){
   this.failed=true;this.generationErrors++;this.manager.dispose();
   for(const page of this.pages.values())for(const buffer of [page.mesh.position,page.mesh.uv,page.mesh.index])this.gl.deleteBuffer(buffer);
   this.pages.clear();throw error;
  }
 }

 private createMesh(directions:Float32Array,uv:Float32Array,indices:Uint32Array):GpuMesh{
  const gl=this.gl,created:WebGLBuffer[]=[];
  const buffer=(target:number,data:BufferSource):WebGLBuffer=>{const value=gl.createBuffer();if(!value)throw new Error('Unable to allocate geodesic mesh buffer.');created.push(value);gl.bindBuffer(target,value);gl.bufferData(target,data,gl.STATIC_DRAW);return value;};
  try{return{position:buffer(gl.ARRAY_BUFFER,directions),uv:buffer(gl.ARRAY_BUFFER,uv),index:buffer(gl.ELEMENT_ARRAY_BUFFER,indices),count:indices.length};}
  catch(error){for(const item of created)gl.deleteBuffer(item);throw error;}
 }

 private upload(page:Page):boolean{
  if(page.layer!==undefined&&this.gpu?.getLayer(page.data?.key??'')!==undefined)return true;
  if(!page.data||!this.gpu)return false;
  const key=page.data.key;
  try{
   this.manager.markUploadPending(key);
   const layer=this.gpu.upload(page.data);
   this.manager.markGpuReady(key);
   page.layer=layer;page.error=undefined;
   return true;
  }catch(error){
   page.error=error instanceof Error?error.message:String(error);this.generationErrors++;
   return false;
  }
 }

 render(frame:GeodesicPlanetFrame):boolean{
  if(this.disposed||this.failed||!this.program||!this.gpu||!this.profile||this.pages.size!==20)return false;
  const gl=this.gl,visible:Page[]=[];
  for(const page of this.pages.values()){
   if(page.layer===undefined||this.gpu.getLayer(page.data?.key??'')===undefined)this.upload(page);
   const layer=this.gpu.getLayer(page.data?.key??'');
   if(layer!==undefined){page.layer=layer;visible.push(page);}
  }
  this.ready=visible.length===20&&[...this.pages.values()].every(page=>page.layer!==undefined&&!page.error);
  if(!this.ready)return false;
  const pinned:string[]=[];
  try{
   for(const page of visible){const key=page.data?.key??'';if(!this.gpu.pin(key))return false;pinned.push(key);this.manager.markVisible(key,true);}
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
    const layer=this.gpu.getLayer(page.data?.key??'');if(layer===undefined)continue;
    gl.uniform1f(this.locations.uLayer,layer);
    gl.bindBuffer(gl.ARRAY_BUFFER,page.mesh.position);gl.enableVertexAttribArray(this.attribs.direction);gl.vertexAttribPointer(this.attribs.direction,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,page.mesh.uv);gl.enableVertexAttribArray(this.attribs.uv);gl.vertexAttribPointer(this.attribs.uv,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,page.mesh.index);
    gl.drawElements(gl.TRIANGLES,page.mesh.count,gl.UNSIGNED_INT,0);
   }
   gl.disable(gl.CULL_FACE);
   return true;
  }catch(error){this.generationErrors++;this.failed=true;return false;}
  finally{for(const key of pinned){this.gpu?.unpin(key);this.manager.markVisible(key,false);}gl.disable(gl.CULL_FACE);}
 }

 private disposeGpuOnly():void{
  for(const page of this.pages.values())for(const buffer of [page.mesh.position,page.mesh.uv,page.mesh.index])this.gl.deleteBuffer(buffer);
  this.pages.clear();this.gpu?.dispose();this.gpu=null;
  if(this.program)this.gl.deleteProgram(this.program);this.program=null;
 }
 dispose():void{if(this.disposed)return;this.disposed=true;this.manager.dispose();this.disposeGpuOnly();}
 get isReady():boolean{return this.ready;}
 get isFailed():boolean{return this.failed;}
 get loadedTileCount():number{return [...this.pages.values()].filter(page=>Boolean(page.data)).length;}
 get visibleTileCount():number{return this.ready?20:0;}
 get gpuResidentTileCount():number{return this.gpu?.residentPages??0;}
 get workerCount():number{return this.manager.workerCount;}
 get queuedCount():number{return this.manager.queuedCount;}
 get cpuCacheBytes():number{return this.manager.memoryBytes;}
 get gpuPinnedPages():number{return this.gpu?.pinnedPages??0;}
 get errorCount():number{return this.generationErrors;}
}

