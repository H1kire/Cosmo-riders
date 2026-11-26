import { AU } from '../physics/constants.ts';
import { LightingSystem, planetaryDisplayGain } from '../rendering/lighting/lighting-system.ts';
import { AtmosphereSystem } from '../rendering/atmosphere/atmosphere-system.ts';
import { CloudSystem } from '../rendering/atmosphere/cloud-system.ts';
import { createGraphicsSettings, type GraphicsSettings } from '../rendering/quality/quality-settings.ts';
import { selectMeshLod, planetaryOrbitOpacity, planetaryLabelOpacity, projectedOrbitRadius } from '../rendering/quality/render-lod.ts';
import { calculateEclipse } from '../rendering/lighting/eclipse-system.ts';
import { surfaceSeedForId } from '../rendering/geodesic/surface-profile.ts';
import { WebGPUBackend, type WebGPUBodyDraw } from '../rendering/webgpu/webgpu-backend.ts';

const COLORS={sun:[1,.68,.24],mercury:[.48,.49,.5],venus:[.82,.62,.36],earth:[.2,.43,.82],moon:[.62,.65,.69],mars:[.72,.29,.2],io:[.82,.68,.24],titan:[.7,.43,.2],jupiter:[.7,.48,.31],saturn:[.76,.68,.48],uranus:[.35,.72,.76],neptune:[.22,.34,.76]};
const KINDS={sun:6,mercury:2,venus:5,earth:1,moon:2,mars:2,jupiter:3,saturn:3,uranus:4,neptune:4,titan:5};
const RING_OUTER_SCALES:Record<string,number>={saturn:2.32,jupiter:1.82,uranus:2.05,neptune:2.0};
const TEXTURE_DETAIL_CAPS={low:.65,medium:.95,high:1.25,ultra:1.5};
const NAMES={sun:'Солнце',mercury:'Меркурий',venus:'Венера',earth:'Земля',moon:'Луна',mars:'Марс',jupiter:'Юпитер',saturn:'Сатурн',uranus:'Уран',neptune:'Нептун'};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const m=Math.hypot(...a)||1;return a.map(v=>v/m);};
function perspective(f,a,n,fz){const q=1/Math.tan(f/2),d=1/(n-fz);return[q/a,0,0,0,0,q,0,0,0,0,(fz+n)*d,-1,0,0,2*fz*n*d,0];}
function lookAt(e,t,u){const z=norm(sub(e,t)),x=norm(cross(u,z)),y=cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1];}
function multiply(a,b){const o=Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function bodyModelMatrix(body,radius,p,timeSeconds,state,parentState,rotationAngle=0){
 const relativePosition=state&&parentState?[state.position.x-parentState.position.x,state.position.y-parentState.position.y,state.position.z-parentState.position.z]:null;
 const relativeVelocity=state&&parentState?[state.velocity.x-parentState.velocity.x,state.velocity.y-parentState.velocity.y,state.velocity.z-parentState.velocity.z]:null;
 const mapVector=v=>[v[0],v[2],v[1]];
 if(body.tidalLock&&relativePosition&&relativeVelocity){
  const orbitNormal=norm(mapVector(cross(relativePosition,relativeVelocity)));
  const towardParent=norm(mapVector([parentState.position.x-state.position.x,parentState.position.y-state.position.y,parentState.position.z-state.position.z]));
  const right=norm(cross(orbitNormal,towardParent));
  if(Math.hypot(...right)>0.5){
   const up=norm(cross(towardParent,right));
   return [right[0]*radius,up[0]*radius,towardParent[0]*radius,0,right[1]*radius,up[1]*radius,towardParent[1]*radius,0,right[2]*radius,up[2]*radius,towardParent[2]*radius,0,p[0],p[1],p[2],1];
  }
 }
 let spinAxis,forward;
 if(body.poleRightAscensionRad!==null&&body.poleRightAscensionRad!==undefined&&body.poleDeclinationRad!==null&&body.poleDeclinationRad!==undefined){
  const epsilon=23.4392911*Math.PI/180,ra=body.poleRightAscensionRad,dec=body.poleDeclinationRad;
  const equatorial=[Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec)];
  const ecliptic=[equatorial[0],Math.cos(epsilon)*equatorial[1]+Math.sin(epsilon)*equatorial[2],-Math.sin(epsilon)*equatorial[1]+Math.cos(epsilon)*equatorial[2]];
  spinAxis=norm(mapVector(ecliptic));
  const equatorialNorth=mapVector([0,Math.sin(epsilon),Math.cos(epsilon)]);
  let reference=cross(equatorialNorth,spinAxis);
  if(Math.hypot(...reference)<1e-7){
   const axis=[1,0,0],projection=dot(axis,spinAxis);
   reference=axis.map((value,index)=>value-spinAxis[index]*projection);
  }
  forward=norm(reference);
 }else{
  const orbitNormal=relativePosition&&relativeVelocity?norm(mapVector(cross(relativePosition,relativeVelocity))):[0,1,0];
  const reference=[1,0,0],projection=dot(reference,orbitNormal);
  const orbitX=norm(reference.map((value,index)=>value-orbitNormal[index]*projection));
  const orbitY=norm(cross(orbitNormal,orbitX));
  const tilt=body.axialTiltRad??0;
  spinAxis=norm(orbitNormal.map((value,index)=>value*Math.cos(tilt)+orbitY[index]*Math.sin(tilt)));
  const projectionX=dot(orbitX,spinAxis);
  forward=norm(orbitX.map((value,index)=>value-spinAxis[index]*projectionX));
 }
 const right=norm(cross(spinAxis,forward));
 forward=norm(cross(right,spinAxis));
 const angle=rotationAngle??0,ca=Math.cos(angle),sa=Math.sin(angle);
 const rotatedRight=right.map((value,index)=>value*ca-forward[index]*sa);
 const rotatedForward=right.map((value,index)=>value*sa+forward[index]*ca);
 return [rotatedRight[0]*radius,spinAxis[0]*radius,rotatedForward[0]*radius,0,
  rotatedRight[1]*radius,spinAxis[1]*radius,rotatedForward[1]*radius,0,
  rotatedRight[2]*radius,spinAxis[2]*radius,rotatedForward[2]*radius,0,p[0],p[1],p[2],1];
}
function scaleModelMatrix(model,factor){return [model[0]*factor,model[1]*factor,model[2]*factor,0,model[4]*factor,model[5]*factor,model[6]*factor,0,model[8]*factor,model[9]*factor,model[10]*factor,0,model[12],model[13],model[14],1];}
function loadGraphicsSettings():GraphicsSettings{
 try{const saved=JSON.parse(localStorage.getItem('cosmo-riders.graphics.v1')??'null') as Partial<GraphicsSettings>|null;const preset=saved&&['low','medium','high','ultra'].includes(saved.preset??'')?saved.preset!:'high';const base=createGraphicsSettings(preset);return saved?{...base,...saved,preset,geodesic:base.geodesic}:base;}
 catch{return createGraphicsSettings('high');}
}
export class Solar3DView{
 [key: string]: any;
 readonly ready:Promise<void>;
 constructor(canvas){
  this.canvas=canvas;this.disposed=false;this.webgpuBackend=null;this.webgpuCanvas=canvas;this.backendPreference='webgpu';this.activeBackend='WebGPU';this.backendFallbackReason=null;this.ready=this.initialize();
 }
 private readBackendPreference():'webgpu'{return 'webgpu';}
 private async initializeWebGPUBackend():Promise<boolean>{
  if(this.disposed)return false;if(this.webgpuBackend?.state==='ready')return true;
  const canvas=this.canvas;canvas.classList.add('solar-webgpu-canvas');canvas.setAttribute('aria-label','WebGPU Solar System renderer');
  Object.assign(canvas.style,{position:'absolute',inset:'0',display:'block',width:'100%',height:'100%',pointerEvents:'auto',zIndex:'0',visibility:'hidden'});
  this.webgpuCanvas=canvas;
  const backend=new WebGPUBackend(canvas);this.webgpuBackend=backend;
  try{
   await backend.ready;
   if(this.disposed){backend.dispose();return false;}
   if(backend.state!=='ready')throw new Error(backend.error??'WebGPU initialization did not reach ready state.');
   this.backendFallbackReason=null;this.activeBackend='WebGPU';canvas.style.visibility='visible';
   this.webgpuLossHandler=()=>{void this.handleWebGPUDeviceLoss();};window.addEventListener('graphics-backend-lost',this.webgpuLossHandler);
   return true;
  }catch(error){
   this.backendFallbackReason=error instanceof Error?error.message:String(error);
   backend.dispose();if(this.webgpuBackend===backend)this.webgpuBackend=null;
   canvas.style.visibility='hidden';this.activeBackend='WebGPU unavailable';return false;
  }
 }
 private async handleWebGPUDeviceLoss():Promise<void>{
  const backend=this.webgpuBackend;if(!backend||this.disposed)return;
  const recovered=await backend.recover();if(this.disposed)return;
  if(recovered&&backend.state==='ready'){
   this.activeBackend='WebGPU';this.backendFallbackReason=null;
   this.canvas.style.visibility='visible';
  }else{
   this.backendFallbackReason=backend.error??'WebGPU device recovery failed; no graphics fallback is available.';
   this.activeBackend='WebGPU unavailable';
   this.canvas.style.visibility='hidden';
  }
 }
 private observeLongTasks():void{
  if(typeof PerformanceObserver==='undefined')return;
  try{
   const supported=(PerformanceObserver as any).supportedEntryTypes as string[]|undefined;
   if(supported&&!supported.includes('longtask'))return;
   const observer=new PerformanceObserver(list=>{
    for(const entry of list.getEntries()){this.longTaskCount++;this.longestLongTaskMs=Math.max(this.longestLongTaskMs,entry.duration);}
   });
   observer.observe({entryTypes:['longtask']});this.longTaskObserver=observer;
  }catch{/* Long Task timing is optional and must never block startup. */}
 }
 private markInitializationStage(name:string):void{
  const now=performance.now(),start=this.initializationStageStartedAt??this.initializationStartedAt??now;
  this.initializationStages[name]=now-start;this.initializationStageStartedAt=now;
 }
 private async yieldToBrowser():Promise<void>{
  const ended=performance.now(),started=this.syncSliceStartedAt??ended;
  this.longestSynchronousChunkMs=Math.max(this.longestSynchronousChunkMs,ended-started);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>{this.syncSliceStartedAt=performance.now();resolve();}));
 }
 private async initialize():Promise<void>{
  const canvas=this.canvas;
  this.initializationStartedAt=performance.now();this.initializationStageStartedAt=this.initializationStartedAt;this.initializationStages={};
  this.syncSliceStartedAt=this.initializationStartedAt;this.longestSynchronousChunkMs=0;this.longTaskCount=0;this.longestLongTaskMs=0;
  this.observeLongTasks();this.graphics=loadGraphicsSettings();this.backendPreference='webgpu';
  const webgpuReady=await this.initializeWebGPUBackend();
  if(!webgpuReady)throw new Error('Cosmo-riders требует WebGPU: '+(this.backendFallbackReason??'инициализация WebGPU не удалась.'));
  this.exposureCompensation=this.graphics.exposure;this.lastExposureUpdateMs=0;this.lastFrameDurationMs=0;this.averageFrameDurationMs=0;
  this.orbitSegmentCounts=new Map();this.orbitVisibilityStates=new Map();this.orbitElementRefs=new Map();
  this.orbitCache=new Map();this.stellarSourceDefinitions=new Map();this.projected=[];this.labelNodes=new Map();
  await this.yieldToBrowser();this.markInitializationStage('webgpu-device-ready');
  this.graphicsChangeHandler=(event:Event)=>{
   const value=(event as CustomEvent<Partial<GraphicsSettings>>).detail??{};
   this.graphics={...this.graphics,...value};
  };
  window.addEventListener('graphics-settings-change',this.graphicsChangeHandler);
  this.atmosphereSystem=new AtmosphereSystem();this.cloudSystem=new CloudSystem();this.lighting=new LightingSystem();
  this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];
  this.drag=null;this.focusId=null;this.focusTransition=null;
  this.labels=document.createElement('div');this.labels.className='body-label-layer';canvas.parentElement.append(this.labels);this.bind();
  this.markInitializationStage('webgpu-scene-ready');
 }
 getGraphicsDiagnostics(){
  const backend=this.webgpuBackend,limits=backend?.device?.limits??{};
  return{
   backendPreference:'webgpu',activeBackend:this.activeBackend??'WebGPU',webgpuAvailable:Boolean((navigator as any).gpu),
   webgpuState:backend?.state??'unavailable',webgpuFormat:backend?.format??null,
   webgpuAdapterInfo:backend?.adapter?.info?.description??backend?.adapter?.info?.device??null,
   webgpuError:backend?.error??this.backendFallbackReason??null,webgpuInitializationMs:backend?.initializationMs??0,
   initializationStages:{...(this.initializationStages??{})},initializationElapsedMs:this.initializationStartedAt?performance.now()-this.initializationStartedAt:0,
   longestSynchronousChunkMs:this.longestSynchronousChunkMs??0,longTaskCount:this.longTaskCount??0,longestLongTaskMs:this.longestLongTaskMs??0,
   webgl2:false,maxArrayTextureLayers:'—',maxTextureSize:limits.maxTextureDimension2D??'—',
   maxVertexTextureImageUnits:'—',maxFragmentTextureImageUnits:'—',maxCombinedTextureImageUnits:'—',
   maxVertexUniformVectors:'—',maxFragmentUniformVectors:'—',maxVertexAttributes:'—',extensions:[],
   mode:'webgpu',active:backend?.state==='ready'?'WebGPU':'WebGPU unavailable',rendererState:backend?.state??'unavailable',
   pendingRendererState:null,pendingRendererError:null,requestedPageSize:this.graphics?.geodesic?.pageResolution??0,
   requestedMeshResolution:this.graphics?.geodesic?.meshResolution??0,pageSize:0,pageBytes:0,gpuCacheBytes:0,gpuLayers:0,
   failedGpuCacheBytes:0,failedGpuLayers:0,failedGpuResidentPages:0,allocatedTextureArrays:0,gpuResidentPages:0,
   gpuPinnedPages:0,cpuCacheBytes:0,cpuCachePages:0,generatedPages:0,uploadedPages:0,workerCount:0,workerActive:0,
   workerQueued:0,workerStartupErrors:0,workerRuntimeErrors:0,workerTaskErrors:0,cancelledTasks:0,disposedTasks:0,
   meshGenerationMs:0,surfaceGenerationMs:0,firstFailure:backend?.error??null,failureTaskKind:null,failureTaskKey:null,
   failureTimestamp:null,rendererFailureCount:backend?.state==='failed'?1:0,rendererErrors:backend?.state==='failed'?1:0,
   uploadErrors:0,fallbackReason:backend?.state==='ready'?'WebGPU is the only renderer.':this.backendFallbackReason??'WebGPU is unavailable.'
  };
 }
 configurePlanetEffects(){
  const profiles:[string,number,[number,number,number],number,number][]=[
   ['earth',110000,[.22,.48,1.0],.62,1.0],
   ['titan',400000,[.72,.43,.18],.96,1.25],
   ['venus',250000,[1.0,.58,.28],.92,1.1],
   ['mars',100000,[1.0,.34,.19],.34,.72],
   ['jupiter',1200000,[.82,.62,.43],.48,.58],
   ['saturn',900000,[.91,.73,.49],.52,.52],
   ['uranus',500000,[.42,.82,.88],.36,.48],
   ['neptune',500000,[.28,.48,1.0],.44,.55]
  ];
  for(const [id,height,color,mie,intensity] of profiles){
   const body=this.systemBodyById?.get(id);
   if(body)this.atmosphereSystem.setProfile({bodyId:id,groundRadiusM:body.meanRadiusM,atmosphereHeightM:height,rayleigh:color, mie,rayleighScaleHeightM:height*.12,mieScaleHeightM:height*.08,mieAnisotropy:.76,intensity});
  }
  const cloudProfiles:[string,number,number,number,number][]=[
   ['earth',18000,.48,.82,5.8],
   ['titan',18000,.72,.62,3.8],
   ['venus',55000,.59,.78,4.4],
   ['jupiter',70000,.55,.54,7.2],
   ['saturn',65000,.58,.48,6.0],
   ['uranus',35000,.61,.38,5.0],
   ['neptune',30000,.58,.4,5.4]
  ];
  for(const [id,altitudeM,coverage,opacity,scale] of cloudProfiles){
   this.cloudSystem.setLayers(id,[{id:'main',altitudeM,coverage,opacity,wind:[.0002,.0001],scale}]);
  }
 }
 collectOccluders(body,bodyState,sunState,bodies,states,renderOrigin){
  const sx=sunState.position.x-bodyState.position.x,sy=sunState.position.y-bodyState.position.y,sz=sunState.position.z-bodyState.position.z;
  const sunDistance=Math.hypot(sx,sy,sz);if(sunDistance<=0)return{positions:new Float32Array(24),radii:new Float32Array(8),count:0};
  const direction=[sx/sunDistance,sy/sunDistance,sz/sunDistance];
  const candidates=[];
  for(const other of bodies){
   if(other.id===body.id||other.id==='sun')continue;
   const state=states.get(other.id);if(!state)continue;
   const dx=state.position.x-bodyState.position.x,dy=state.position.y-bodyState.position.y,dz=state.position.z-bodyState.position.z;
   const along=dx*direction[0]+dy*direction[1]+dz*direction[2];
   if(along<=0||along>=sunDistance)continue;
   const px=dx-direction[0]*along,py=dy-direction[1]*along,pz=dz-direction[2]*along;
   const perpendicular=Math.hypot(px,py,pz),radius=other.meanRadiusM;
   if(perpendicular>radius+body.meanRadiusM)continue;
   candidates.push({state,body:other,score:perpendicular/Math.max(radius,1)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const selected=candidates.slice(0,Math.min(8,this.graphics.shadowOccluders));
  const positions=new Float32Array(24),radii=new Float32Array(8);
  selected.forEach((item,index)=>{
   const mapped=this.mapPosition({x:item.state.position.x-renderOrigin.x,y:item.state.position.y-renderOrigin.y,z:item.state.position.z-renderOrigin.z});
   positions.set(mapped,index*3);radii[index]=item.body.meanRadiusM/AU;
  });
  return{positions,radii,count:selected.length};
 }


 bind(){
  const c=this.canvas;
  c.tabIndex=0;
  c.addEventListener('contextmenu',e=>e.preventDefault());
  c.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==1&&e.button!==2)return;
    e.preventDefault();
    c.focus({preventScroll:true});
    this.drag={x:e.clientX,y:e.clientY,moved:false,button:e.button,pointerId:e.pointerId};
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove',e=>{
    if(!this.drag||this.drag.pointerId!==e.pointerId)return;
    const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
    this.drag.moved ||= Math.hypot(dx,dy)>3;
    // KSP-style map controls: RMB orbits the camera around the current target.
    if(this.drag.button===2){
      this.yaw-=dx*.006;
      this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch+dy*.006));
    // MMB pans in the camera's screen plane, with speed scaled to zoom level.
    }else if(this.drag.button===1){
      const scalePerPixel=2*this.distance*Math.tan(Math.PI/6)/Math.max(1,c.clientHeight);
      const right=[Math.cos(this.yaw),0,-Math.sin(this.yaw)];
      const up=[-Math.sin(this.yaw)*Math.sin(this.pitch),Math.cos(this.pitch),-Math.cos(this.yaw)*Math.sin(this.pitch)];
      const panTarget=this.focusId?this.focusOffset:this.target;for(let axis=0;axis<3;axis++)panTarget[axis]+=(-right[axis]*dx+up[axis]*dy)*scalePerPixel;
    }
    this.drag.x=e.clientX;
    this.drag.y=e.clientY;
  });
  const end=e=>{
    if(!this.drag||this.drag.pointerId!==e.pointerId)return;
    if(!this.drag.moved&&this.drag.button===0)this.pick(e);
    this.drag=null;
  };
  c.addEventListener('pointerup',end);
  c.addEventListener('pointercancel',()=>{this.drag=null;});
  c.addEventListener('lostpointercapture',()=>{this.drag=null;});
  c.addEventListener('wheel',e=>{
    e.preventDefault();
    const nextDistance=this.distance*Math.exp(e.deltaY*.001);
    if(Number.isFinite(nextDistance)){
      const focused=this.focusId?this.systemBodyById?.get(this.focusId):null;
      const minimum=focused?focused.meanRadiusM/AU*1.025:1e-8;
      this.distance=Math.max(minimum,Math.min(1e4,nextDistance));
    }
  },{passive:false});
  c.addEventListener('keydown',e=>{if(e.key==='Home')this.home();});
 }
 getGeodesicEarthDiagnostics(){return{state:'webgpu',ready:this.webgpuBackend?.state==='ready',failed:this.webgpuBackend?.state==='failed',loaded:0,visible:0,gpuResident:0,workers:0,queued:0,cpuBytes:0,pinned:0,errors:this.webgpuBackend?.state==='failed'?1:0,fallbackReason:this.webgpuBackend?.error??null};}
 setStellarSource(id:string,positionSI:[number,number,number],options:{intensity?:number;color?:[number,number,number]}={}){
  if(!id||id==='sun')throw new TypeError('Use a unique non-primary stellar source id.');
  if(!positionSI.every(Number.isFinite))throw new TypeError('Stellar source coordinates must be finite SI values.');
  this.stellarSourceDefinitions.set(id,{positionSI:[...positionSI],intensity:options.intensity??22,color:options.color?[...options.color] as [number,number,number]:[1,1,1]});
 }
 removeStellarSource(id:string){if(id==='sun')throw new TypeError('The primary Sun source cannot be removed.');this.stellarSourceDefinitions.delete(id);this.lighting.removeSource(id);}
 focusOn(id,world){
  const item=world?.bodies?.get(id);
  if(!item)return false;
  const radius=item.meanRadiusM/AU;
  const nextDistance=Math.max(radius*18,1e-9);
  this.focusId=id;
  this.focusOffset=[0,0,0];
  this.focusTransition={from:this.distance,to:nextDistance,started:performance.now(),duration:720};
  return true;
 }
 home(){this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];this.focusId=null;this.focusTransition=null;}
 mapPosition(p):[number,number,number]{return[p.x/AU,p.z/AU,p.y/AU];}
 pick(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bestScore=Infinity;for(const [id,p] of this.projected){const hitRadius=Math.max(8,Math.min(72,p.projectedRadius??8));const d=Math.hypot(x-p.x,y-p.y),score=d/hitRadius;if(d<=hitRadius&&score<bestScore){bestScore=score;best=id;}}if(best){const item=this.projected.find(v=>v[0]===best),radius=item?.[1]?.radius??1e-5;this.focusId=best;this.focusOffset=[0,0,0];this.distance=Math.max(1e-10,radius*1.08);this.canvas.dispatchEvent(new CustomEvent('bodyselect',{detail:{id:best}}));}}
 project(vp,p,w,h){const[x,y,z]=p,cx=vp[0]*x+vp[4]*y+vp[8]*z+vp[12],cy=vp[1]*x+vp[5]*y+vp[9]*z+vp[13],cz=vp[2]*x+vp[6]*y+vp[10]*z+vp[14],cw=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];return cw>0?{x:(cx/cw*.5+.5)*w,y:(1-(cy/cw*.5+.5))*h,z:cz/cw}:null;}
 drawOrbit(world,body,states,sunPosition,vp,mapper,opacity=1,eye,viewportHeight,bodyDistance,renderOrigin){
  if(!body.parentId||!body.orbitalElements)return;
  const parent=world.bodies.get(body.parentId),parentState=states.get(body.parentId);if(!parent||!parentState)return;
  const parentPosition=mapper(parent,parentState.position),parentDistance=Math.hypot(parentPosition[0]-eye[0],parentPosition[1]-eye[1],parentPosition[2]-eye[2]);
  opacity*=planetaryOrbitOpacity(bodyDistance,body.meanRadiusM/AU);
  const projected=projectedOrbitRadius(body.orbitalElements.semiMajorAxisM/AU,viewportHeight,parentDistance);
  let orbitVisible=this.orbitVisibilityStates.get(body.id)??projected>.08;
  if(orbitVisible?projected<.02:projected>.08)orbitVisible=!orbitVisible;
  this.orbitVisibilityStates.set(body.id,orbitVisible);if(!orbitVisible)return;
  const visibility=Math.max(0,Math.min(1,(projected-.035)/.36));
  const smoothVisibility=visibility*visibility*(3-2*visibility);
  opacity*=smoothVisibility;if(opacity<=0.001)return;
  const elements=body.orbitalElements;
  const targetSegments=Math.ceil(Math.max(128,Math.min(1024,128+projected*.8+elements.eccentricity*320))/32)*32;
  let segments=this.orbitSegmentCounts.get(body.id)??128;
  if(targetSegments>segments*1.2||targetSegments<segments*.55){segments=targetSegments;this.orbitSegmentCounts.set(body.id,segments);}
  let path=this.orbitCache.get(body.id);
  const elementsChanged=this.orbitElementRefs.get(body.id)!==elements;
  if(!path||path.length!==(segments+1)*3||elementsChanged){
   let source=world.orbitPaths?.get(body.id);if(!source){if(typeof world.ensureOrbitPath==='function')void world.ensureOrbitPath(body.id,segments).catch(error=>{this.orbitPathErrors??=new Map();this.orbitPathErrors.set(body.id,error instanceof Error?error.message:String(error));});return;}if(source.length<6)return;
   const sourceSegments=source.length/3-1;path=new Float32Array((segments+1)*3);
   for(let i=0;i<=segments;i++){
    const sourceIndex=Math.round(i*sourceSegments/segments),o=sourceIndex*3;
    path[i*3]=source[o]/AU;path[i*3+1]=source[o+2]/AU;path[i*3+2]=source[o+1]/AU;
   }
   this.orbitCache.set(body.id,path);this.orbitElementRefs.set(body.id,elements);
  }
  const model=[1,0,0,0,0,1,0,0,0,0,1,0,(parentState.position.x-renderOrigin.x)/AU,(parentState.position.z-renderOrigin.z)/AU,(parentState.position.y-renderOrigin.y)/AU,1];
  this.webgpuOrbits.push({id:body.id,points:path,model,color:body.id==='earth'?[.32,.58,.9]:[.18,.28,.42],opacity:.62*opacity});
 }
 render(world,states,timeSeconds,vesselState=null){
  const frameStarted=performance.now();
  if(this.focusTransition){
   const progress=Math.min(1,(performance.now()-this.focusTransition.started)/this.focusTransition.duration);
   const eased=progress*progress*(3-2*progress);
   this.distance=this.focusTransition.from+(this.focusTransition.to-this.focusTransition.from)*eased;
   if(progress>=1)this.focusTransition=null;
  }
  const c=this.canvas,r=c.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
  const rawWidth=Math.max(1,Math.round(r.width*dpr)),rawHeight=Math.max(1,Math.round(r.height*dpr));
  const rawPixels=rawWidth*rawHeight,pixelScale=rawPixels>1920*1080?Math.sqrt((1920*1080)/rawPixels):1;
  const w=Math.max(1,Math.round(rawWidth*pixelScale)),h=Math.max(1,Math.round(rawHeight*pixelScale));
  const sunState=states.get('sun')??{position:{x:0,y:0,z:0}};
  const sun=sunState.position,bodies=[...world.bodies.values()];
  this.systemBodyById=new Map(bodies.map(body=>[body.id,body]));
  if(!this.effectsConfigured){this.configurePlanetEffects();this.effectsConfigured=true;}
  const focus=this.focusId?world.bodies.get(this.focusId):null,focusState=focus?states.get(focus.id):null;
  const focusSunDistance=focusState?Math.hypot(focusState.position.x-sun.x,focusState.position.y-sun.y,focusState.position.z-sun.z)/AU:1;
  // Экспозиция кадра не зависит от фокуса; ослабление света учитывается отдельно на поверхности.
  this.exposureCompensation=this.graphics.exposure;
  this.lastExposureUpdateMs=frameStarted;
  if(focusState){this.cameraOrigin=[0,0,0];this.target=this.focusOffset.slice();}
  else{this.cameraOrigin=[0,0,0];this.target=[0,0,0];}
  const eye=[this.target[0]+this.distance*Math.cos(this.pitch)*Math.sin(this.yaw),this.target[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.distance*Math.cos(this.pitch)*Math.cos(this.yaw)];
  const focusRadius=focus?focus.meanRadiusM/AU:0;
  const far=100,near=Math.max(1e-10,Math.min(this.distance*.01,focusRadius>0?focusRadius*.02:this.distance*.01));
  const vp=multiply(perspective(Math.PI/3,w/h,near,far),lookAt(eye,this.target,[0,1,0]));
  this.projected=[];
  const webgpuBodies:WebGPUBodyDraw[]=[];this.webgpuOrbits=[];this.webgpuRings=[];
  const renderOrigin=focusState?focusState.position:sun;
  const mapper=(body,p,out?:[number,number,number])=>{const x=(p.x-renderOrigin.x)/AU,y=(p.z-renderOrigin.z)/AU,z=(p.y-renderOrigin.y)/AU;if(out){out[0]=x;out[1]=y;out[2]=z;return out;}return[x,y,z] as [number,number,number];};
  const sunRenderPosition=mapper(null,sun);this.currentSunPosition=sunRenderPosition;
  if(this.lighting.getSources().some(source=>source.id==='sun'))this.lighting.updateSource('sun',{position:sunRenderPosition});
  else this.lighting.addSource({id:'sun',kind:'point',position:sunRenderPosition,intensity:22,color:[1,.96,.86]});
  // Keep externally registered stellar sources while refreshing the primary star position.
  for(const [id,source] of this.stellarSourceDefinitions){
   const position=mapper(null,{x:source.positionSI[0],y:source.positionSI[1],z:source.positionSI[2]});
   if(this.lighting.getSources().some(item=>item.id===id))this.lighting.updateSource(id,{position});
   else this.lighting.addSource({id,kind:'point',position,intensity:source.intensity,color:source.color});
  }
  for(const body of bodies){
  const bodyState=states.get(body.id);if(!bodyState)continue;
  const bodyPosition=mapper(body,bodyState.position);
  const bodyDistance=Math.hypot(bodyPosition[0]-eye[0],bodyPosition[1]-eye[1],bodyPosition[2]-eye[2]);
  this.drawOrbit(world,body,states,sun,vp,mapper,1,eye,h,bodyDistance,renderOrigin);
 }
  for(const body of bodies){
   const state=states.get(body.id);if(!state)continue;
   const p=mapper(body,state.position);if(!p)continue;
   const radius=body.meanRadiusM/AU,viewDistance=Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]);
   const px=radius*(h/2)/(Math.tan(Math.PI/6)*Math.max(radius,viewDistance));
   const projectedScreen=this.project(vp,p,w/dpr,h/dpr);
   const level=selectMeshLod(px,this.graphics.maxMeshLod);
   
   const parentState=body.parentId?states.get(body.parentId):null;
   const rotationAngle=world.renderRotationAngles?.get(body.id)??world.rotationAngles?.get(body.id)??0;
   const model=bodyModelMatrix(body,radius,p,timeSeconds,state,parentState,rotationAngle);
   const webgpuBody:WebGPUBodyDraw={id:body.id,model,position:p,color:(COLORS[body.id]??(body.parentId?[.5,.6,.8]:[1,.72,.42])) as [number,number,number],star:!body.parentId,kind:body.id==='mars'?7:body.id==='moon'?8:(KINDS[body.id]??2),seed:body.surfaceSeed??surfaceSeedForId(body.id),waterFraction:body.surface?.waterFraction??0,iceFraction:body.surface?.iceFraction??0,ironFraction:body.surface?.ironFraction??0,tectonicActivity:body.surface?.tectonicActivity??0,volcanicActivity:body.surface?.volcanicActivity??0,erosion:body.surface?.erosion??0,detail:Math.min(TEXTURE_DETAIL_CAPS[this.graphics.textureQuality]??1,Math.max(0,Math.min(1.5,Math.log2(Math.max(1,px)/18)/4))),lod:level};
   webgpuBodies.push({id:body.id,model,...webgpuBody});
   const webgpuDraw=webgpuBodies[webgpuBodies.length-1];
   const isStar=!body.parentId;
   const occluders=this.collectOccluders(body,state,sunState,bodies,states,renderOrigin);
    const webgpuShadowOccluders=new Float32Array(32);
    for(let occluderIndex=0;occluderIndex<occluders.count;occluderIndex++){
     const sourceOffset=occluderIndex*3,targetOffset=occluderIndex*4;
     webgpuShadowOccluders[targetOffset]=occluders.positions[sourceOffset];
     webgpuShadowOccluders[targetOffset+1]=occluders.positions[sourceOffset+1];
     webgpuShadowOccluders[targetOffset+2]=occluders.positions[sourceOffset+2];
     webgpuShadowOccluders[targetOffset+3]=occluders.radii[occluderIndex];
    }
    webgpuDraw.shadowOccluders=webgpuShadowOccluders;
    webgpuDraw.shadowsEnabled=this.graphics.shadows;
   let webgpuEclipseVisibility=1;
   if(this.graphics.shadows&&!isStar){
    const observerPosition=[state.position.x,state.position.y,state.position.z] as [number,number,number];
    const sourcePosition=[sun.x,sun.y,sun.z] as [number,number,number];
    for(const blockerBody of bodies){
     if(blockerBody.id===body.id||blockerBody.id==='sun')continue;
     const blockerState=states.get(blockerBody.id);if(!blockerState)continue;
     webgpuEclipseVisibility*=calculateEclipse(sourcePosition,696340000,[blockerState.position.x,blockerState.position.y,blockerState.position.z],blockerBody.meanRadiusM,observerPosition).visibility;
     if(webgpuEclipseVisibility<0.001)break;
    }
   }
   webgpuDraw.eclipseVisibility=webgpuEclipseVisibility;
   if(body.hasRings){const ringModel=scaleModelMatrix(model,RING_OUTER_SCALES[body.id]??2.0);this.webgpuRings.push({id:body.id,model:ringModel});}
   const profile=this.atmosphereSystem.getProfile(body.id);
   const cloudLayers=this.cloudSystem.getLayers(body.id);
   if(this.graphics.atmosphere&&profile){
    webgpuDraw.atmosphere={color:profile.rayleigh,intensity:(profile.intensity??1)*this.graphics.atmosphereIntensity,thicknessRatio:profile.atmosphereHeightM/body.meanRadiusM,mie:profile.mie,anisotropy:profile.mieAnisotropy};
   }
   if(this.graphics.clouds&&cloudLayers.length){
    webgpuDraw.clouds=cloudLayers.map(layer=>({altitudeRatio:layer.altitudeM/body.meanRadiusM,coverage:layer.coverage,opacity:layer.opacity,scale:layer.scale,wind:layer.wind}));
   }
   const screen=projectedScreen;
   if(screen&&screen.z>=-1&&screen.z<=1&&screen.x>=-20&&screen.x<=w/dpr+20&&screen.y>=-20&&screen.y<=h/dpr+20)this.projected.push([body.id,{...screen,world:p,radius,projectedRadius:px,viewDistance,labelOpacity:planetaryLabelOpacity(viewDistance,radius)}]);
  }
  // Корабль временно исключён из сцены: активна только Солнечная система.
  const labelCandidates=this.projected.filter(([id])=>Boolean(world.bodies.get(id))).sort((a,b)=>Number(Boolean(world.bodies.get(b[0])?.parentId===null))-Number(Boolean(world.bodies.get(a[0])?.parentId===null))+(b[1].projectedRadius??0)-(a[1].projectedRadius??0));
  const occupied=[] as {left:number;top:number;right:number;bottom:number}[];
  const offsets=[[12,-13],[12,5],[-12,-13],[-12,5],[0,-23],[0,15]];
  const visibleLabels=new Set<string>();
  for(const [id,p] of labelCandidates){const body=world.bodies.get(id);if(!body)continue;let node=this.labelNodes.get(id);if(!node){node=document.createElement('span');node.className='body-label';this.labels.append(node);this.labelNodes.set(id,node);}node.textContent=body.name;const width=Math.max(34,body.name.length*6.4),height=14;let chosen=null;for(const [dx,dy] of offsets){const left=p.x+dx-(dx<0?width:0),top=p.y+dy,rect={left:left-4,top:top-3,right:left+width+4,bottom:top+height+3};if(rect.left<4||rect.top<4||rect.right>w/dpr-4||rect.bottom>h/dpr-4)continue;if(occupied.every(other=>rect.right<other.left||rect.left>other.right||rect.bottom<other.top||rect.top>other.bottom)){chosen=[left,top];occupied.push(rect);break;}}const labelOpacity=p.labelOpacity??1;if(chosen&&labelOpacity>0.005){node.hidden=false;node.style.opacity=String(labelOpacity);node.style.transform='translate3d('+Math.round(chosen[0])+'px,'+Math.round(chosen[1])+'px,0)';visibleLabels.add(id);}else node.hidden=true;}
  for(const [id,node] of this.labelNodes)if(!visibleLabels.has(id))node.hidden=true;
  const sunScreen=this.project(vp,sunRenderPosition,w/dpr,h/dpr);
  let sunVisible=Boolean(sunScreen&&sunScreen.z>=-1&&sunScreen.z<=1&&sunScreen.x>=0&&sunScreen.x<=w/dpr&&sunScreen.y>=0&&sunScreen.y<=h/dpr);
  if(sunVisible){
   const observerSI={x:renderOrigin.x+eye[0]*AU,y:renderOrigin.y+eye[2]*AU,z:renderOrigin.z+eye[1]*AU};
   const observer=[observerSI.x,observerSI.y,observerSI.z] as [number,number,number];
   const source=[sun.x,sun.y,sun.z] as [number,number,number];
   let visibility=1;
   for(const body of bodies){
    if(body.id==='sun')continue;
    const state=states.get(body.id);if(!state)continue;
    const blocker=[state.position.x,state.position.y,state.position.z] as [number,number,number];
    visibility*=calculateEclipse(source,696340000,blocker,body.meanRadiusM,observer).visibility;
    if(visibility<.001)break;
   }
   sunVisible=visibility>.02;
  }
  if(this.webgpuBackend?.state==='ready'){this.webgpuBackend.render({viewProjection:vp,bodies:webgpuBodies,orbits:this.webgpuOrbits,rings:this.webgpuRings,sunPosition:sunRenderPosition,sunRadius:696340000/AU,cameraPosition:eye,timeSeconds,sunUv:sunScreen?[sunScreen.x/(w/dpr),1-sunScreen.y/(h/dpr)]:[0.5,0.5],sunVisible,postProcessing:{bloom:this.graphics.bloom,bloomThreshold:this.graphics.bloomThreshold,bloomStrength:this.graphics.bloomStrength,bloomIterations:this.graphics.bloomIterations,exposure:this.graphics.exposure,hdr:this.graphics.hdr,toneMapping:this.graphics.hdr?'aces':'reinhard',glare:this.graphics.glare,glareStrength:this.graphics.glareStrength,lensFlare:this.graphics.lensFlare,lensFlareStrength:this.graphics.lensFlareStrength}});this.canvas.style.visibility='visible';this.activeBackend='WebGPU';}else{this.canvas.style.visibility='hidden';this.activeBackend='WebGPU unavailable';}
  this.lastRenderTime=timeSeconds;
  this.lastFrameDurationMs=performance.now()-frameStarted;
  this.averageFrameDurationMs=this.averageFrameDurationMs?this.averageFrameDurationMs*.9+this.lastFrameDurationMs*.1:this.lastFrameDurationMs;
  if(frameStarted-(this.lastDiagnosticsPublish??0)>=500){this.lastDiagnosticsPublish=frameStarted;window.dispatchEvent(new CustomEvent('graphics-diagnostics',{detail:this.getGraphicsDiagnostics()}));}
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;this.longTaskObserver?.disconnect();
  window.removeEventListener('graphics-settings-change',this.graphicsChangeHandler);
  if(this.webgpuLossHandler)window.removeEventListener('graphics-backend-lost',this.webgpuLossHandler);
  this.orbitSegmentCounts?.clear();this.orbitVisibilityStates?.clear();this.orbitElementRefs?.clear();
  this.webgpuBackend?.dispose();this.webgpuBackend=null;this.webgpuCanvas=null;
  this.labels?.remove();this.labelNodes?.clear();this.orbitCache?.clear();this.stellarSourceDefinitions?.clear();
 }
}